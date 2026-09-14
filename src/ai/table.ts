/** Synchronous table actions. Playing always awaits shared Rust Walt.
 * Declaration retains the existing own-information chooser for now. */
import { type Action, type GameState, type Seat, legalActions } from '../engine';
import type { Difficulty } from './index';
import { observe } from './observation';
import { hardAction } from './hard';
export function chooseAction(state: GameState, seat: Seat, _difficulty: Difficulty, rand: () => number): Action {
  if (state.phase === 'playing') throw new Error('Playing must await Walt.');
  if (state.phase === 'hand-over') return { type: 'next-hand' };
  if (state.turn !== seat) throw new Error('Not this seat’s turn.');
  const actions = legalActions(state);
  if (actions.length === 1) return actions[0]!;
  return hardAction(observe(state, seat), actions, rand);
}
