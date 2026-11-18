/**
 * Head-to-head strength: full games to 7 marks under the default casual
 * config, fixed (committed) seeds, alternating which team plays which
 * difficulty each game to cancel seat/shake bias.
 *
 * Thresholds (do not weaken):
 *   medium beats easy   in >= 65% of 40 games
 *   hard   beats easy   in >= 70% of 24 games
 *   hard   beats medium in >= 54% of 24 games
 */

import { describe, expect, it } from 'vitest';
import { playGame, type SeatDiffs } from '../src/ai/harness';
import type { Difficulty } from '../src/ai';

// Preserve the exact seeds, alternating seats, game counts, and thresholds.
// Yield between games so the worker can acknowledge reporting messages even
// when macOS gives the background builder less CPU time.
async function playMatch(_config:undefined,seedBase:string,games:number,a:Difficulty,b:Difficulty) {
  let winsA=0;
  for(let g=0;g<games;g++) {
    const team=g%2, diffs:SeatDiffs=team===0?[a,b,a,b]:[b,a,b,a];
    if(playGame(undefined,`${seedBase}-${g}`,diffs).final.winner===team)winsA++;
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  return {winsA,games};
}

describe('AI strength ladder', () => {
  it('medium beats easy in >= 65% of 40 games', async () => {
    const { winsA, games } = await playMatch(undefined, 'strength-medium-easy', 40, 'medium', 'easy');
    expect(games).toBe(40);
    expect(winsA).toBeGreaterThanOrEqual(Math.ceil(0.65 * 40)); // 26
  }, 60_000);

  it('hard beats easy in >= 70% of 24 games', async () => {
    const { winsA, games } = await playMatch(undefined, 'strength-hard-easy', 24, 'hard', 'easy');
    expect(games).toBe(24);
    expect(winsA).toBeGreaterThanOrEqual(Math.ceil(0.7 * 24)); // 17
  }, 90_000);

  it('hard beats medium in >= 54% of 24 games', async () => {
    const { winsA, games } = await playMatch(undefined, 'strength-hard-medium', 24, 'hard', 'medium');
    expect(games).toBe(24);
    expect(winsA).toBeGreaterThanOrEqual(Math.ceil(0.54 * 24)); // 13
  }, 90_000);
});
