/**
 * onyx end-to-end play: with the ONNX session warmed and the prediction cache
 * pre-filled for each onyx decision, onyx plays full games and every action it
 * returns is legal. This exercises the REAL net path (not the hard fallback):
 * the in-scope play decisions hit the cache and use pi_me; bidding/declaring and
 * out-of-scope contracts fall back to hard.
 *
 * Driven by an async harness (predictAsync before each onyx step) because ONNX
 * inference is async while chooseAction is synchronous.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Action,
  type GameState,
  type Seat,
  applyAction,
  legalActions,
  mulberry32,
  newGame,
  toSeed,
  CASUAL_CONFIG,
} from '../src/engine';
import { chooseAction, type Difficulty } from '../src/ai';
import { observe } from '../src/ai/observation';
import { onyxReady, predictAsync, preloadOnyx } from '../src/ai/onyx';

const here = dirname(fileURLToPath(import.meta.url));

type SeatDiffs = readonly [Difficulty, Difficulty, Difficulty, Difficulty];

/** Async game driver: pre-warms onyx predictions, then steps synchronously. */
async function playGameAsync(
  seed: string,
  diffs: SeatDiffs,
  onAction: (s: GameState, seat: Seat, a: Action, legal: readonly Action[]) => void,
): Promise<GameState> {
  let st = newGame({ ...CASUAL_CONFIG, targetMarks: 3 }, seed);
  const rands = ([0, 1, 2, 3] as Seat[]).map((s) => mulberry32(toSeed(`${seed}/seat${s}`)));
  let steps = 0;
  while (st.phase !== 'game-over') {
    if (++steps > 100_000) throw new Error('did not terminate');
    const seat = (st.turn ?? st.shaker) as Seat;
    if (diffs[seat] === 'onyx' && st.phase === 'playing' && st.turn === seat) {
      await predictAsync(observe(st, seat)); // warm the cache for this decision
    }
    const action = chooseAction(st, seat, diffs[seat]!, rands[seat]!);
    onAction(st, seat, action, legalActions(st));
    st = applyAction(st, action);
  }
  return st;
}

describe('onyx plays legal, complete games (warmed net path)', () => {
  beforeAll(async () => {
    const bytes = readFileSync(join(here, 'fixtures', 'onyx.onnx'));
    await preloadOnyx(new Uint8Array(bytes));
    expect(onyxReady()).toBe(true);
  }, 60_000);

  it('every onyx action is legal across full games', async () => {
    let checked = 0;
    let onyxPlays = 0;
    for (let g = 0; g < 3; g++) {
      // onyx on team 0 (seats 0,2), hard on team 1 (seats 1,3).
      const diffs: SeatDiffs = ['onyx', 'hard', 'onyx', 'hard'];
      const final = await playGameAsync(`onyx-legal-${g}`, diffs, (s, seat, action, legal) => {
        const json = JSON.stringify(action);
        expect(legal.some((l) => JSON.stringify(l) === json), `illegal ${json}`).toBe(true);
        checked++;
        if (diffs[seat] === 'onyx' && s.phase === 'playing' && action.type === 'play') {
          onyxPlays++;
        }
      });
      expect(final.phase).toBe('game-over');
      expect(final.winner).not.toBeNull();
    }
    expect(checked).toBeGreaterThan(100);
    expect(onyxPlays).toBeGreaterThan(20); // onyx actually made play decisions
  }, 60_000);
});
