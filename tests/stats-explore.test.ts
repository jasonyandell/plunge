import { describe, expect, it } from 'vitest';
import { readHands, matchesMetric, sameContract, sameDeal } from '../src/stats/model';
import { demoHands } from '../src/stats/demo';
import { finishedRecord, partialRecord } from './hand-fixtures';

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
});
