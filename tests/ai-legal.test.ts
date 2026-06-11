/**
 * Legality + completion: every difficulty, across mixed seats, seeds, and
 * configs (casual with Nel-O/Plunge/Splash, tournament, forced-bid, house
 * variants), chooseAction always returns a member of legalActions and games
 * run to completion. Also checks determinism for a fixed seed.
 */

import { describe, expect, it } from 'vitest';
import {
  CASUAL_CONFIG,
  TOURNAMENT_CONFIG,
  type GameConfig,
} from '../src/engine';
import { type SeatDiffs, playGame } from '../src/ai/harness';

const CONFIGS: readonly { name: string; config: GameConfig }[] = [
  { name: 'casual', config: { ...CASUAL_CONFIG, targetMarks: 5 } },
  { name: 'tournament', config: { ...TOURNAMENT_CONFIG, targetMarks: 5 } },
  {
    name: 'forced-nello',
    config: {
      ...CASUAL_CONFIG,
      targetMarks: 5,
      allPass: 'force-30-or-nello',
      nelloMinMarks: 2,
      forced30SweepBonus: true,
    },
  },
  {
    name: 'house',
    config: {
      ...CASUAL_CONFIG,
      targetMarks: 5,
      plungeMarks: 3,
      splashMarks: 3,
      nelloDoubles: 'high',
      noTrumpDoubles: 'low',
      sevens: 'on',
    },
  },
];

// Every pattern seats all three difficulties, so 24 games gives every
// difficulty well over 20 full games in mixed company.
const PATTERNS: readonly SeatDiffs[] = [
  ['easy', 'medium', 'hard', 'medium'],
  ['medium', 'easy', 'medium', 'hard'],
  ['hard', 'medium', 'easy', 'easy'],
  ['medium', 'hard', 'easy', 'medium'],
];

describe('AI legality over full games', () => {
  it('always picks a legal action and completes 24 mixed games', () => {
    let actionsChecked = 0;
    for (let g = 0; g < 24; g++) {
      const { config } = CONFIGS[g % CONFIGS.length]!;
      const diffs = PATTERNS[g % PATTERNS.length]!;
      const { final } = playGame(config, `ai-legal-${g}`, diffs, {
        onAction: (_state, _seat, action, legal) => {
          const json = JSON.stringify(action);
          expect(
            legal.some((l) => JSON.stringify(l) === json),
            `illegal action ${json} (game ${g})`,
          ).toBe(true);
          actionsChecked++;
        },
      });
      expect(final.phase).toBe('game-over');
      expect(final.winner).not.toBeNull();
      expect(Math.max(...final.marks)).toBeGreaterThanOrEqual(config.targetMarks);
    }
    expect(actionsChecked).toBeGreaterThan(1000);
  }, 120_000);

  it('is deterministic for a fixed seed (hard included)', () => {
    const run = () => {
      const log: string[] = [];
      const { final } = playGame(
        { ...CASUAL_CONFIG, targetMarks: 3 },
        'ai-determinism',
        ['hard', 'medium', 'easy', 'hard'],
        { onAction: (_s, seat, action) => log.push(`${seat}:${JSON.stringify(action)}`) },
      );
      return `${log.join('\n')}|${final.marks.join(',')}`;
    };
    expect(run()).toEqual(run());
  }, 60_000);
});
