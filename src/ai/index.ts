/**
 * AI players. Public contract: `chooseAction` must return a member of
 * `legalActions(state)` for the given seat, deterministically given `rand`.
 *
 * (Stub implementation — random legal action; real easy/medium/hard players
 * replace this.)
 */

import {
  type Action, type GameState, type Seat, legalActions,
} from '../engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

export function chooseAction(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty,
  rand: () => number,
): Action {
  if (state.turn !== seat) throw new Error(`not seat ${seat}'s turn`);
  const actions = legalActions(state);
  const action = actions[Math.floor(rand() * actions.length)];
  if (!action) throw new Error('no legal actions');
  return action;
}
