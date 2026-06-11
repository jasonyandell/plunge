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
import { playMatch } from '../src/ai/harness';

describe('AI strength ladder', () => {
  it('medium beats easy in >= 65% of 40 games', () => {
    const { winsA, games } = playMatch(undefined, 'strength-medium-easy', 40, 'medium', 'easy');
    expect(games).toBe(40);
    expect(winsA).toBeGreaterThanOrEqual(Math.ceil(0.65 * 40)); // 26
  }, 60_000);

  it('hard beats easy in >= 70% of 24 games', () => {
    const { winsA, games } = playMatch(undefined, 'strength-hard-easy', 24, 'hard', 'easy');
    expect(games).toBe(24);
    expect(winsA).toBeGreaterThanOrEqual(Math.ceil(0.7 * 24)); // 17
  }, 90_000);

  it('hard beats medium in >= 54% of 24 games', () => {
    const { winsA, games } = playMatch(undefined, 'strength-hard-medium', 24, 'hard', 'medium');
    expect(games).toBe(24);
    expect(winsA).toBeGreaterThanOrEqual(Math.ceil(0.54 * 24)); // 13
  }, 90_000);
});
