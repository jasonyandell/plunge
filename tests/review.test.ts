import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { type Action, type GameState, LEGACY_PLUNGE_CONFIG, applyAction, legalActions, newGame } from '../src/engine';
import { encodeReplay } from '../src/engine/replay-code';
import {
  START, back, finalState, forward, handSteps, parseReviewHash, play, positionAt, resetBranch, reviewHash, sameAction,
  tokenAction, actionToken,
} from '../src/review/steps';
import { collectHands, deviceSources, failingSources, loadLibrary, type LibrarySources } from '../src/review/library';
import { compareOptions, estimateOptions, finishHand, hindsight, outcomeOf, type OptionEstimate } from '../src/review/whatif';
import { comparisonSentence, outcomeSentence, timeline } from '../src/review/describe';
import { exampleRecords } from '../src/review/fixtures';
import { appendSnapshot, historyDb, listHistory, snapshotOf } from '../src/history/recorder';
import { initialApp, reducer } from '../src/ui/store';

const played = (seed: string): GameState => finishHand(newGame(LEGACY_PLUNGE_CONFIG, seed));

describe('replay and branching', () => {
  const g = played('review-replay');
  const steps = handSteps(g)!;
  const end = finalState(steps, g);

  it('replays every recorded decision back to the recorded result', () => {
    expect(steps.length).toBeGreaterThan(8);
    expect(encodeReplay(end)).toBe(encodeReplay(g));
    expect(positionAt(steps, end, { at: steps.length, branch: [] })).toBe(end);
  });

  it('advances on the recorded move and branches on any other legal move', () => {
    const i = steps.findIndex(s => s.action.type === 'play' && legalActions(s.state).length > 1);
    const at = { at: i, branch: [] };
    expect(play(steps, end, at, steps[i]!.action)).toEqual({ at: i + 1, branch: [] });
    const other = legalActions(steps[i]!.state).find(a => !sameAction(a, steps[i]!.action))!;
    const branched = play(steps, end, at, other)!;
    expect(branched).toEqual({ at: i, branch: [other] });
    const tip = positionAt(steps, end, branched)!;
    // The branch continues with any legal move for whoever is next, and undo/reset unwind it.
    const next = play(steps, end, branched, legalActions(tip)[0]!)!;
    expect(next.branch).toHaveLength(2);
    expect(back(next)).toEqual(branched);
    expect(resetBranch(next)).toEqual(at);
    expect(forward(steps, next)).toBe(next);
    expect(back({ at: 0, branch: [] })).toEqual(START);
  });

  it('refuses illegal moves and stale branches instead of applying them', () => {
    const i = steps.findIndex(s => s.action.type === 'play' && legalActions(s.state).length < s.state.hands[s.state.turn!]!.length);
    const s = steps[i]!;
    const illegal = s.state.hands[s.state.turn!]!.find(d => !legalActions(s.state).some(a => a.type === 'play' && a.domino === d))!;
    expect(play(steps, end, { at: i, branch: [] }, { type: 'play', domino: illegal })).toBeNull();
    expect(positionAt(steps, end, { at: i, branch: [{ type: 'play', domino: illegal }] })).toBeNull();
    expect(positionAt(steps, end, { at: steps.length + 1, branch: [] })).toBeNull();
  });

  it('keeps hand, step and branch in a reload-safe hash', () => {
    const i = steps.findIndex(s => s.action.type === 'play' && legalActions(s.state).length > 1);
    const other = legalActions(steps[i]!.state).find(a => !sameAction(a, steps[i]!.action))!;
    const loc = { hand: 'abc-123:2', cursor: { at: i, branch: [other] } };
    const reloaded = parseReviewHash(reviewHash(loc))!;
    expect(reloaded.hand).toBe('abc-123:2');
    expect(positionAt(steps, end, reloaded.cursor)).toEqual(positionAt(steps, end, loc.cursor));
    expect(parseReviewHash('#review')).toEqual({ hand: null, cursor: START });
    expect(parseReviewHash('#review&qa=storage-failure')?.qa).toBe('storage-failure');
    expect(parseReviewHash('#r=v1f0')).toBeNull();
    const actions: Action[] = [
      { type: 'bid', bid: { kind: 'pass' } }, { type: 'bid', bid: { kind: 'points', value: 34 } },
      { type: 'bid', bid: { kind: 'marks', value: 2 } }, { type: 'bid', bid: { kind: 'marks', value: 4, special: 'plunge' } },
      { type: 'declare', decl: { type: 'pip', pip: 5 } }, { type: 'declare', decl: { type: 'no-trump' } }, { type: 'play', domino: '64' },
    ];
    for (const a of actions) expect(tokenAction(actionToken(a))).toEqual(a);
  });

  it('groups the timeline into bidding, trump and tricks', () => {
    const rows = timeline(steps).map(r => r.label);
    expect(rows[0]).toBe('Bidding');
    expect(rows).toContain('Trump');
    expect(rows).toContain('Trick 1');
    expect(timeline(steps).flatMap(r => r.indices)).toEqual(steps.map((_, i) => i));
  });
});

describe('the hand library', () => {
  const g = played('review-library');
  const steps = handSteps(g)!;
  const snap = (state: GameState, gameId = 'game-a', handNumber = 1) =>
    ({ schema: 'plunge-history-v1', gameId, handNumber, code: encodeReplay(state), recordedAt: '2026-10-01T10:00:00Z' });

  it('collapses growing snapshots, merges copies, and keeps unreadable records counted', () => {
    const lib = collectHands([
      { source: 'history', records: [snap(steps[3]!.state), snap(steps[9]!.state), snap(g), { schema: 'plunge-history-v9' }, { nonsense: true }] },
      { source: 'stats', records: [{ schema: 'plunge-hand-v1', gameId: 'game-a', handNumber: 1, code: encodeReplay(g), endedAt: '2026-10-01T10:05:00Z' }] },
      { source: 'records', records: [{ record: { schema: 'plunge-hand-v2', code: encodeReplay(g), game: { id: 'f'.repeat(32), hand: 1 },
        ended: '2026-10-01T10:06:00Z', assist: [{ before: 4 }, { before: 2 }] }, synced: false }] },
      { source: 'pending', records: [{ game: steps[12]!.state, sessionId: 'game-b' }, { game: null }] },
    ]);
    const full = lib.hands.find(h => h.code === encodeReplay(g))!;
    expect(full.sources).toEqual(['history', 'stats', 'records']);
    expect(full.key).toBe('game-a:1');
    expect(full.hintsBefore).toEqual([2, 4]);
    expect(full.finished).toBe(true);
    expect(full.recordedAt).toBe('2026-10-01T10:06:00Z');
    // The pending hand is a different game, kept separately and marked unfinished.
    expect(lib.hands.filter(h => h.gameId === 'game-b').map(h => h.finished)).toEqual([false]);
    expect(lib.hands).toHaveLength(2);
    expect(lib.unreadable.reduce((n, u) => n + u.count, 0)).toBe(2);
  });

  it('keeps divergent records of one hand as separate lines and counts corrupt codes', () => {
    const alt = legalActions(steps[10]!.state).find(a => !sameAction(a, steps[10]!.action))!;
    const branch = applyAction(steps[10]!.state, alt);
    const lib = collectHands([{ source: 'history', records: [snap(g), snap(branch), { ...snap(g, 'game-c'), code: 'v1f0garbage.' }] }]);
    expect(lib.hands.map(h => h.key).sort()).toEqual(['game-a:1', 'game-a:1~1']);
    expect(lib.unreadable).toEqual([{ source: 'history', schema: 'unreplayable', count: 1 }]);
  });

  it('shows what it can when a store fails, and names the failing store', async () => {
    const sources: LibrarySources = { ...failingSources(), history: async () => [snap(g)] };
    const lib = await loadLibrary(sources);
    expect(lib.hands).toHaveLength(1);
    expect([...lib.unavailable].sort()).toEqual(['pending', 'records', 'stats']);
    expect((await loadLibrary(failingSources())).hands).toEqual([]);
  });

  it('reads device stores without writing, and never creates the rescued journal', async () => {
    const app = reducer(initialApp(), { type: 'new-game', seed: 'review-device', sessionId: 'review-device' });
    await appendSnapshot(snapshotOf(app)!);
    const before = await listHistory();
    const store = new Map<string, string>([['plunge:history:pending:x', JSON.stringify(app)], ['other', 'kept']]);
    const local = { get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null, setItem: () => { throw new Error('review must not write'); },
      removeItem: () => { throw new Error('review must not delete'); } };
    (globalThis as { localStorage?: unknown }).localStorage = local;
    try {
      const lib = await loadLibrary(await deviceSources());
      expect(lib.unavailable).toEqual([]);
      expect((await listHistory()).length).toBe(before.length);
      expect(store.size).toBe(2);
      expect((await indexedDB.databases()).some(d => d.name === 'plunge-records')).toBe(false);
      // Bidding has not started in this game, so there is nothing to review yet.
      expect(lib.hands.filter(h => h.gameId === 'review-device')).toEqual([]);
      const bid = reducer(app, { type: 'human', action: { type: 'bid', bid: { kind: 'points', value: 30 } } });
      store.set('plunge:history:pending:y', JSON.stringify(bid));
      const after = await loadLibrary(await deviceSources());
      expect(after.hands.some(h => h.gameId === 'review-device' && h.sources.includes('pending'))).toBe(true);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
    expect((await historyDb()).name).toBe('plunge-history');
  });

  it('reads an existing rescued journal as-is', async () => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('plunge-records', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('hands', { keyPath: 'record.id' });
        r.result.createObjectStore('reviews', { keyPath: 'id' });
      };
      r.onsuccess = () => {
        const tx = r.result.transaction('hands', 'readwrite');
        tx.objectStore('hands').add({ record: { schema: 'plunge-hand-v2', id: 'a'.repeat(32), code: encodeReplay(g),
          game: { id: 'b'.repeat(32), hand: 3 }, ended: '2026-09-27T00:00:00Z', assist: [] }, synced: true });
        tx.oncomplete = () => { r.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
    const lib = await loadLibrary(await deviceSources());
    const rescued = lib.hands.find(h => h.sources.includes('records'))!;
    expect(rescued.handNumber).toBe(3);
    expect(rescued.code).toBe(encodeReplay(g));
  });
});

describe('what-if answers', () => {
  const g = played('review-whatif');
  const steps = handSteps(g)!;

  it('finishes a continuation deterministically on the real hands', () => {
    const s = steps.find(x => x.action.type === 'play')!;
    const a = hindsight(s.state, s.action), b = hindsight(s.state, s.action);
    expect(a).toEqual(b);
    expect(a.finished).toBe(true);
    expect(outcomeSentence(a)).toMatch(/made it|were set/);
  });

  it("estimates only from what the deciding seat could see", async () => {
    // Swapping two hidden hands changes the real deal but not the decider's
    // view, so the estimate must not move at all.
    for (const s of [steps[0]!, steps.find(x => x.action.type === 'play' && x.state.tricks.length === 2)!]) {
      const me = s.state.turn!;
      const [x, y] = [0, 1, 2, 3].filter(seat => seat !== me && s.state.hands[seat]!.length === s.state.hands[(me + 2) % 4]!.length);
      const hands = s.state.hands.map(h => [...h]);
      [hands[x!], hands[y!]] = [hands[y!]!, hands[x!]!];
      const swapped: GameState = { ...s.state, hands, dealt: hands };
      const real = await estimateOptions(s.state, 8, 'leak-test');
      const other = await estimateOptions(swapped, 8, 'leak-test');
      expect(other).toEqual(real);
      expect(real.options.map(o => o.action)).toEqual(legalActions(s.state));
    }
  });

  it('reports sampled comparisons as estimates and noise as noise', () => {
    const opt = (nets: number[]): OptionEstimate => ({ action: { type: 'play', domino: '00' }, samples: nets.length,
      ahead: nets.filter(n => n > 0).length, behind: nets.filter(n => n < 0).length,
      averageNet: nets.reduce((a, b) => a + b, 0) / nets.length, averagePoints: 0, nets });
    const base = Array.from({ length: 24 }, (_, i) => (i % 2 ? 1 : -1));
    expect(compareOptions(opt(base), opt(base))).toBe('same');
    expect(compareOptions(opt(base.map((n, i) => (i === 0 ? -n : n))), opt(base))).toBe('too-close');
    expect(compareOptions(opt(base.map(() => 1)), opt(base))).toBe('better');
    expect(compareOptions(opt(base.map(() => -1)), opt(base))).toBe('worse');
    expect(comparisonSentence('better', '6-4', '5-5')).toMatch(/estimate, not a proof/);
    expect(comparisonSentence('too-close', '6-4', '5-5')).toMatch(/sampling noise/);
  });

  it('outcomes come from the engine result', () => {
    const o = outcomeOf(g);
    expect(o.marks[0] + o.marks[1]).toBe(g.thrownIn ? 0 : g.handResult!.marks);
  });
});

describe('example hands', () => {
  it('cover a hand you bid, one you defended, an unfinished hand, and an unknown record', () => {
    const lib = collectHands(exampleRecords());
    expect(lib.hands.map(h => h.key).sort()).toEqual(['example-unfinished:1', 'example-you-bid:1', 'example-you-defend:1']);
    expect(lib.hands.find(h => h.key === 'example-unfinished:1')!.finished).toBe(false);
    expect(lib.hands.find(h => h.key === 'example-you-bid:1')!.game.declarer).toBe(0);
    expect(lib.unreadable).toEqual([{ source: 'example', schema: 'plunge-history-v9', count: 1 }]);
    expect(collectHands(exampleRecords())).toEqual(lib);
  });
});

describe('discussion copy', () => {
  it('reads naturally for you and for other seats', async () => {
    const { talkPrompt } = await import('../src/review/describe');
    const g = played('review-copy');
    const leads = handSteps(g)!.filter(s => s.action.type === 'play' && s.state.currentTrick.length === 0).map(s => talkPrompt(s.state));
    expect(leads.join(' ')).not.toMatch(/is you/);
  });
});
