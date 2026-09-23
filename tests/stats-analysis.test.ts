/**
 * Walt's post-hoc play review: positions rebuilt from the replay, the hint
 * boundary injected (no wasm in tests), verdicts and the resumable cache.
 */

import { describe, expect, it } from 'vitest';
import { legalDominoes } from '../src/engine';
import { decodeReplay } from '../src/engine/replay-code';
import { tileOfId } from '../src/ai/walt/requests';
import type { Hint } from '../src/ai/hint';
import { ANALYSIS_PROFILE, analyzeHand, reviewMissing, type HintFn } from '../src/stats/analysis';
import { allPlays } from '../src/questions/model';
import type { HandAnalysis } from '../src/stats/log';
import { sampleData } from '../src/stats/sample';

const record = sampleData().hands[0]!;

/** Deterministic fake of the on-device player: first legal is always best. */
const fakeHint: HintFn = (g, _sessionId, worlds) => {
  const legal = legalDominoes(g).map(tileOfId).sort((a, b) => a - b);
  const options = legal.map((tile, i) => ({
    tile, chance: i === 0 ? 0.8 : 0.8 - 0.1 * i, successes: null, best: i === 0,
  }));
  const hint = {
    request: {}, requestedWorlds: worlds, choice: legal[0]!, forced: false,
    stats: { worlds, fallback: false, objective: 'make', options }, estimate: null,
  } as unknown as Hint;
  return Promise.resolve(hint);
};

describe('analyzeHand', () => {
  it('rebuilds every human decision and scores it against the injected player', async () => {
    const g = decodeReplay(record.code)!;
    const analysis = await analyzeHand(record, undefined, fakeHint);
    expect(analysis.id).toBe(record.id);
    expect(analysis.profile).toBe(ANALYSIS_PROFILE);
    expect(analysis.unsupported).toBe(false);
    const humanPlies = allPlays(g).map((p, i) => ({ ...p, i })).filter((p) => p.seat === 0);
    expect(analysis.plies.map((v) => v.ply)).toEqual(humanPlies.map((p) => p.i));
    for (const v of analysis.plies) {
      expect(v.played).toBe(tileOfId(allPlays(g)[v.ply]!.domino));
      if (v.forced) {
        expect(v.playedBest).toBe(true);
        expect(v.playedChance).toBeNull();
      } else {
        expect(v.suggested).not.toBeNull();
        expect(v.playedBest).toBe(v.played === v.suggested); // fake: lone best, no ties
        expect(v.bestChance).toBe(0.8);
        expect(v.playedChance).toBeLessThanOrEqual(0.8);
      }
    }
    expect(analysis.plies.some((v) => !v.forced)).toBe(true);
  });

  it('caches out-of-scope contracts as unsupported instead of retrying them forever', async () => {
    const scopeError: HintFn = () => Promise.reject(new Error('Walt needs a straight 42 contract.'));
    const analysis = await analyzeHand(record, undefined, scopeError);
    expect(analysis.unsupported).toBe(true);
    const garbled = await analyzeHand({ ...record, code: 'v1f0nonsense' }, undefined, fakeHint);
    expect(garbled.unsupported).toBe(true);
  });

  it('propagates aborts and transient player failures', async () => {
    const aborting: HintFn = () => Promise.reject(new DOMException('Stopped', 'AbortError'));
    await expect(analyzeHand(record, undefined, aborting)).rejects.toMatchObject({ name: 'AbortError' });
    const flaky: HintFn = () => Promise.reject(new Error('worker crashed'));
    await expect(analyzeHand(record, undefined, flaky)).rejects.toThrow('worker crashed');
  });
});

describe('reviewMissing', () => {
  const records = sampleData().hands.slice(0, 3);

  it('reviews only unreviewed hands, saving each verdict as it lands', async () => {
    const saved: HandAnalysis[] = [];
    const first = await analyzeHand(records[0]!, undefined, fakeHint);
    const progress: number[] = [];
    const fresh = await reviewMissing(records, [first],
      async (a) => { saved.push(a); }, (p) => progress.push(p.done), undefined, fakeHint);
    expect(fresh.map((a) => a.id)).toEqual(records.slice(1).map((r) => r.id));
    expect(saved.length).toBe(2);
    expect(progress).toEqual([0, 1, 2]);
    // A profile bump reopens the whole queue.
    const stale = [{ ...first, profile: 'older-profile' }];
    const redone = await reviewMissing(records, stale, async () => {}, () => {}, undefined, fakeHint);
    expect(redone.length).toBe(3);
  });

  it('stops quietly on abort and resumes from the cache next visit', async () => {
    const controller = new AbortController();
    const saved: HandAnalysis[] = [];
    const oneThenAbort: HintFn = (g, s, w, signal) => {
      controller.abort();
      return fakeHint(g, s, w, signal);
    };
    const fresh = await reviewMissing(records, [],
      async (a) => { saved.push(a); }, () => {}, controller.signal, oneThenAbort);
    expect(fresh.length).toBeLessThan(records.length);
    expect(saved.length).toBe(fresh.length);
    const rest = await reviewMissing(records, fresh, async () => {}, () => {}, undefined, fakeHint);
    expect(fresh.length + rest.length).toBe(records.length);
  });
});
