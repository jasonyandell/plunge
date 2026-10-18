import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type Seat } from '../src/engine';
import { handSteps } from '../src/engine/hand-history';
import { decodeReplay } from '../src/engine/replay-code';
import { actionKey, ghostProgress, replayAt, replayScores } from '../src/stats/ghost';
import { readHands, matchesMetric, sameContract, sameDeal } from '../src/stats/model';
import { attemptBook } from '../src/stats/client';
import { demoHands } from '../src/stats/demo';
import { finishedHand, finishedRecord, partialRecord } from './hand-fixtures';
import nello from './fixtures/nello.json';

describe('stats evidence and replay', () => {
  it('each metric resolves to its actual hands and keeps retries out of counted results', () => {
    const first = finishedRecord('stats-metrics'), retry = { ...first, id: 'retry-r1:1', gameId: 'retry-r1' };
    const partial = partialRecord('partial', 'partial', 5), thrown = finishedRecord('thrown', 'thrown', false);
    const { hands, skipped } = readHands([first, retry, partial, thrown].map(record => ({ id: record.id, record, players: [] })));
    expect(skipped).toBe(0);
    expect(hands.filter(h => matchesMetric(h, 'all'))).toHaveLength(3);
    expect(hands.filter(h => matchesMetric(h, 'retries')).map(h => h.record)).toEqual([retry]);
    expect(hands.filter(h => matchesMetric(h, 'unfinished')).map(h => h.record)).toEqual([partial]);
    expect(hands.filter(h => matchesMetric(h, 'made') || matchesMetric(h, 'set')).map(h => h.record)).toEqual([first]);
    expect(readHands([{ id: 'bad', record: { ...first, code: 'invalid' }, players: [] }]).skipped).toBe(1);
  });
  it('matches the same deal including rules and describes contract similarity precisely', () => {
    const { hands } = readHands(demoHands());
    expect(sameDeal(hands.find(h => h.id === 'demo:0')!, hands.find(h => h.id === 'demo:1')!)).toBe(true);
    const first = hands[0]!, changedRules = { ...first, record: { ...first.record, code: first.record.code.replace(/^v1./, 'v1t') } };
    expect(sameDeal(first, changedRules)).toBe(false);
    expect(sameContract(first, changedRules)).toBe(false);
  });
  it('reconstructs every decision, including Nel-O, without altering the saved hand', () => {
    for (const original of [finishedHand('ghost'), ...nello.slice(0, 2).map(f => decodeReplay(f.replay)!)]) {
      const before = JSON.stringify(original), steps = handSteps(original);
      expect(replayAt(original, steps.length).tricks).toEqual(original.tricks);
      for (const seat of [0, 1, 2, 3] as Seat[]) {
        const choices: Action[] = [];
        let p = ghostProgress(original, seat, choices);
        while (!p.done) {
          expect(p.game.turn).toBe(seat);
          expect(legalActions(p.game).length).toBeGreaterThan(1);
          choices.push(steps[p.index]!.action);
          p = ghostProgress(original, seat, choices);
        }
        expect(p.matched).toBe(p.total); expect(p.divergence).toBeNull();
        expect(p.game.tricks).toEqual(original.tricks);
      }
      expect(JSON.stringify(original)).toBe(before);
    }
  });
  it('stops at the first different legal choice and rejects extra or illegal choices', () => {
    const game = finishedHand('ghost-diverge'), p = ghostProgress(game, 0, []), expected = handSteps(game)[p.index]!.action;
    const other = legalActions(p.game).find(a => actionKey(a) !== actionKey(expected))!;
    const result = ghostProgress(game, 0, [other]);
    expect(result.done).toBe(true); expect(result.matched).toBe(0);
    expect(result.game).toEqual(p.game); expect(result.divergence?.original).toEqual(expected);
    expect(() => ghostProgress(game, 0, [other, expected])).toThrow('after the replay diverged');
    expect(() => ghostProgress(game, 0, [{ type: 'play', domino: '99' }])).toThrow('not legal');
  });
  it('resumes the first device attempt, preserves its score through retries and isolates demo scores', async () => {
    const record = finishedRecord('book', 'book');
    const hand = readHands([{ id: 'test:book', record, players: [] }]).hands[0]!;
    const book = attemptBook(hand, 0, null, false);
    const [first] = await book.start(), again = await attemptBook(hand, 0, null, false).start();
    expect(again[0]?.id).toBe(first!.id); expect(again).toHaveLength(1);
    const p = ghostProgress(hand.game, 0, []), steps = handSteps(hand.game);
    const wrong = legalActions(p.game).find(a => actionKey(a) !== actionKey(steps[p.index]!.action))!;
    await book.save(first!.id, [wrong]);
    const retries = await book.start(), retry = retries[1]!;
    const choices: Action[] = [];
    let progress = ghostProgress(hand.game, 0, choices);
    while (!progress.done) {
      choices.push(steps[progress.index]!.action);
      await book.save(retry.id, [...choices]);
      progress = ghostProgress(hand.game, 0, choices);
    }
    const saved = await book.list(), scores = replayScores(saved);
    expect(scores.first?.matched).toBe(0); expect(scores.best).toBe(progress.total); expect(scores.retries).toBe(1);
    await expect(book.save(first!.id, [])).rejects.toThrow('Another tab');
    expect(await attemptBook(hand, 0, null, true).list()).toEqual([]);
    expect(await attemptBook(hand, 1, null, false).list()).toEqual([]);
  });
});
