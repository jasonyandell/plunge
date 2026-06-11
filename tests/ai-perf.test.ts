/**
 * Hard's decision-time budget: across a couple of full all-hard games,
 * average chooseAction time < 150 ms and worst case < 400 ms.
 */

import { describe, expect, it } from 'vitest';
import {
  type Seat,
  applyAction,
  mulberry32,
  newGame,
  toSeed,
} from '../src/engine';
import { chooseAction } from '../src/ai/index';

describe('hard AI decision time', () => {
  it('averages < 150ms and never exceeds 400ms', () => {
    const times: number[] = [];
    for (const seed of ['ai-perf-a', 'ai-perf-b']) {
      const rands = ([0, 1, 2, 3] as Seat[]).map((s) =>
        mulberry32(toSeed(`${seed}/seat${s}`)),
      );
      let st = newGame(undefined, seed);
      let steps = 0;
      while (st.phase !== 'game-over') {
        if (++steps > 100_000) throw new Error('perf game did not terminate');
        const seat = (st.turn ?? st.shaker) as Seat;
        const t0 = performance.now();
        const action = chooseAction(st, seat, 'hard', rands[seat]!);
        times.push(performance.now() - t0);
        st = applyAction(st, action);
      }
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    // eslint-disable-next-line no-console
    console.log(`hard decisions: n=${times.length} avg=${avg.toFixed(2)}ms max=${max.toFixed(2)}ms`);
    expect(times.length).toBeGreaterThan(200);
    expect(avg).toBeLessThan(150);
    expect(max).toBeLessThan(400);
  }, 60_000);
});
