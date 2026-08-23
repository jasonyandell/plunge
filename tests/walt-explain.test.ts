/**
 * Post-hand analysis (src/ai/walt/explain.ts): replaying a past decision
 * and pricing every option that seat had. Pure request-builder checks, then
 * a real wasm pricing on a finished hand: options are exactly tiles the
 * seat still held, values are sane basis points, the played tile is marked,
 * and the list is sorted best-first for the seat's team.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type GameState,
  CASUAL_CONFIG,
  applyAction,
  mulberry32,
  newGame,
  toSeed,
} from '../src/engine';
import { chooseAction } from '../src/ai';
import { preloadWalt } from '../src/ai/walt';
import {
  explainMove,
  explainRequestOf,
  explainScope,
  goodnessOf,
} from '../src/ai/walt/explain';
import { tileOfId } from '../src/ai/walt/requests';

const here = dirname(fileURLToPath(import.meta.url));

/** Drive full hands with medium until a straight-42 hand finishes. */
function finishedStraightHand(seed: string): GameState {
  let st = newGame({ ...CASUAL_CONFIG, targetMarks: 21 }, seed);
  const rand = mulberry32(toSeed(seed));
  for (let steps = 0; steps < 50_000; steps++) {
    if (st.phase === 'game-over') break;
    if (st.phase === 'hand-over') {
      if (explainScope(st) && st.tricks.length >= 3) return st;
      st = applyAction(st, { type: 'next-hand' });
      continue;
    }
    st = applyAction(st, chooseAction(st, st.turn!, 'medium', rand));
  }
  throw new Error('no straight finished hand reached');
}

describe('explain request builder', () => {
  const g = finishedStraightHand('walt-explain');

  it('replays to the exact decision point', () => {
    // First play of the hand: empty record, the leader (declarer) to act.
    const first = explainRequestOf(g, 0, 0, 4);
    expect(first).not.toBeNull();
    expect(first!.req.plays).toEqual([]);
    expect(first!.seat).toBe(g.tricks[0]!.plays[0]!.seat);
    expect(first!.req.hand).toHaveLength(7);
    expect(first!.req.race).toBe(false);

    // A mid-hand play: the record holds every prior play in order.
    const t = 1;
    const p = 2;
    const rr = explainRequestOf(g, t, p, 4);
    expect(rr).not.toBeNull();
    const before = g.tricks[0]!.plays.length + p;
    expect(rr!.req.plays).toHaveLength(2 * before);
    expect(rr!.seat).toBe(g.tricks[t]!.plays[p]!.seat);
    expect(rr!.domino).toBe(g.tricks[t]!.plays[p]!.domino);
    // The dealt hand contains the tile that was played there.
    expect(rr!.req.hand).toContain(tileOfId(rr!.domino));
  });

  it('rejects out-of-range and out-of-scope decisions', () => {
    expect(explainRequestOf(g, 99, 0, 4)).toBeNull();
    expect(explainRequestOf(g, 0, 99, 4)).toBeNull();
    const nello: GameState = { ...g, declaration: { type: 'nello' } };
    expect(explainRequestOf(nello, 0, 0, 4)).toBeNull();
    expect(explainScope(nello)).toBe(false);
  });
});

describe('explain on the real solver', () => {
  beforeAll(async () => {
    const bytes = new Uint8Array(
      readFileSync(join(here, '..', 'src', 'ai', 'walt', 'walt.wasm')),
    );
    await preloadWalt(bytes);
  }, 60_000);

  it('prices every option the seat held, played tile included', async () => {
    const g = finishedStraightHand('walt-explain');
    const trick = g.tricks.length - 2;
    const play = 1;
    const rec = g.tricks[trick]!.plays[play]!;
    const exp = await explainMove(g, trick, play, 4);
    expect(exp).not.toBeNull();
    expect(exp!.seat).toBe(rec.seat);
    expect(exp!.domino).toBe(rec.domino);

    if (!exp!.forced) {
      expect(exp!.options.length).toBeGreaterThan(0);
      // Every option is a tile the seat was dealt and had not yet played.
      const played = new Set(
        g.tricks
          .slice(0, trick)
          .flatMap((t) => t.plays)
          .concat(g.tricks[trick]!.plays.slice(0, play))
          .filter((q) => q.seat === rec.seat)
          .map((q) => q.domino),
      );
      const dealt = new Set(g.dealt[rec.seat]!);
      for (const o of exp!.options) {
        expect(dealt.has(o.domino)).toBe(true);
        expect(played.has(o.domino)).toBe(false);
        expect(o.bp).toBeGreaterThanOrEqual(0);
        expect(o.bp).toBeLessThanOrEqual(10_000);
      }
      // The played tile is in the list and marked.
      expect(exp!.options.some((o) => o.played && o.domino === rec.domino)).toBe(true);
      // Sorted best-first for the seat's team; head carries the best flag.
      const good = exp!.options.map((o) => goodnessOf(o.bp, exp!.declaringTeam));
      for (let i = 1; i < good.length; i++) expect(good[i - 1]!).toBeGreaterThanOrEqual(good[i]!);
      expect(exp!.options[0]!.best).toBe(true);
    }

    // Cached: the same ask resolves to the identical explanation.
    const again = await explainMove(g, trick, play, 4);
    expect(again).toEqual(exp);
  }, 120_000);
});
