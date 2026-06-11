import { describe, expect, it } from 'vitest';
import {
  type Action, type GameState,
  TOTAL_HAND_POINTS, applyAction, legalActions, mulberry32, newGame, toSeed,
} from '../src/engine';

/** Play full random games to completion, asserting basic sanity throughout. */
describe('random game smoke test', () => {
  it('plays 50 full games to completion with only legal actions', () => {
    for (let g = 0; g < 50; g++) {
      const rand = mulberry32(toSeed(`smoke-${g}`));
      let state: GameState = newGame(undefined, `game-${g}`);
      let steps = 0;
      while (state.phase !== 'game-over') {
        const actions = legalActions(state);
        expect(actions.length).toBeGreaterThan(0);
        const action: Action = actions[Math.floor(rand() * actions.length)]!;
        state = applyAction(state, action);
        steps++;
        expect(steps).toBeLessThan(20000);
        // points never exceed 42 in a hand
        expect(state.points[0] + state.points[1]).toBeLessThanOrEqual(TOTAL_HAND_POINTS);
      }
      expect(state.winner).not.toBeNull();
      expect(Math.max(...state.marks)).toBeGreaterThanOrEqual(7);
    }
  });

  it('is deterministic for a given seed', () => {
    const run = (seed: string) => {
      const rand = mulberry32(toSeed('det'));
      let state = newGame(undefined, seed);
      const log: string[] = [];
      while (state.phase !== 'game-over' && log.length < 5000) {
        const actions = legalActions(state);
        const action = actions[Math.floor(rand() * actions.length)]!;
        log.push(JSON.stringify(action));
        state = applyAction(state, action);
      }
      return log.join('\n') + JSON.stringify(state.marks);
    };
    expect(run('same-seed')).toEqual(run('same-seed'));
  });
});
