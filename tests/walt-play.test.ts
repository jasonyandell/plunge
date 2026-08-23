/**
 * walt end-to-end: the REAL wasm solver (src/ai/walt/walt.wasm, loaded
 * in-process — no Worker in Node) drives full games through the same
 * pre-warm → synchronous-lookup bridge the UI uses. Asserts:
 *   - every action walt returns is legal, and games complete,
 *   - walt's decisions actually come from the solver (counters), not just
 *     the hard fallback,
 *   - the per-play conformance cross-check (walt's independently derived
 *     leader + banked points vs our engine) never fires,
 *   - the solver is deterministic per request.
 *
 * Sample sizes are turned way down (n=4) for speed — strength is not under
 * test here; walt ships at n=40.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Action,
  type GameState,
  type Seat,
  CASUAL_CONFIG,
  applyAction,
  legalActions,
  mulberry32,
  newGame,
  toSeed,
} from '../src/engine';
import { chooseAction, type Difficulty } from '../src/ai';
import {
  configureWalt,
  preloadWalt,
  prewarmWalt,
  waltCounters,
  waltReady,
} from '../src/ai/walt';
import { Walt } from '../src/ai/walt/walt';

const here = dirname(fileURLToPath(import.meta.url));
const wasmBytes = () =>
  new Uint8Array(readFileSync(join(here, '..', 'src', 'ai', 'walt', 'walt.wasm')));

type SeatDiffs = readonly [Difficulty, Difficulty, Difficulty, Difficulty];

/** Async game driver: pre-warms walt's response, then steps synchronously. */
async function playGameAsync(
  seed: string,
  diffs: SeatDiffs,
  onAction: (s: GameState, seat: Seat, a: Action, legal: readonly Action[]) => void,
): Promise<GameState> {
  let st = newGame({ ...CASUAL_CONFIG, targetMarks: 2 }, seed);
  const rands = ([0, 1, 2, 3] as Seat[]).map((s) => mulberry32(toSeed(`${seed}/seat${s}`)));
  let steps = 0;
  while (st.phase !== 'game-over') {
    if (++steps > 100_000) throw new Error('did not terminate');
    const seat = (st.turn ?? st.shaker) as Seat;
    if (diffs[seat] === 'walt' && st.turn === seat) {
      await prewarmWalt(st, seat); // warm the cache for this decision
    }
    const action = chooseAction(st, seat, diffs[seat]!, rands[seat]!);
    onAction(st, seat, action, legalActions(st));
    st = applyAction(st, action);
  }
  return st;
}

describe('walt plays legal, complete games (warmed solver path)', () => {
  beforeAll(async () => {
    configureWalt({ n: 4, n0: 2 });
    await preloadWalt(wasmBytes());
    expect(waltReady()).toBe(true);
  }, 60_000);

  it('bids, declares, and plays legally across full games; conformance holds', async () => {
    let checked = 0;
    for (let g = 0; g < 2; g++) {
      // walt on team 0 (seats 0,2), hard on team 1 (seats 1,3).
      const diffs: SeatDiffs = ['walt', 'hard', 'walt', 'hard'];
      const final = await playGameAsync(`walt-legal-${g}`, diffs, (_s, _seat, action, legal) => {
        const json = JSON.stringify(action);
        expect(legal.some((l) => JSON.stringify(l) === json), `illegal ${json}`).toBe(true);
        checked++;
      });
      expect(final.phase).toBe('game-over');
      expect(final.winner).not.toBeNull();
    }
    expect(checked).toBeGreaterThan(60);
    // The solver actually decided — this was not the hard fallback all along.
    expect(waltCounters.netPlays).toBeGreaterThan(15);
    expect(waltCounters.netBids).toBeGreaterThan(3);
    // Two independent rules engines agreed on every replay.
    expect(waltCounters.conformanceFailures).toBe(0);
  }, 240_000);
});

describe('walt determinism', () => {
  it('same request, same response bytes', async () => {
    const walt = await Walt.load(wasmBytes());
    const req = {
      decl: 9, // no-trump
      bid: 30,
      seat: 0,
      bidder: 0,
      hand: [0, 3, 7, 12, 18, 21, 27],
      plays: [],
      n: 4,
      n0: 2,
      seed: 42,
    };
    const r1 = walt.play(req);
    const r2 = walt.play(req);
    expect(r2).toEqual(r1);
    expect(req.hand).toContain(r1.choice);
    expect(r1.leader).toBe(0);
    expect(r1.points).toEqual([0, 0]);
  }, 120_000);
});
