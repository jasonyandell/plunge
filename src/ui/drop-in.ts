/**
 * Scratch: a real hand from the kitchen table, dropped on the player.
 *
 * Open the app with #drop (or #drop=<seed> to vary the other three hands).
 * You shook, Earl, Gran and Ruby all pass, and under the house rule the
 * bid lands on you — at least 30, no passing out of it.
 */

import {
  ALL_DOMINO_IDS, type DominoId, type GameState,
  PLUNGE_CONFIG, applyAction, mulberry32, newDealtGame, shuffled, toSeed,
} from '../engine';
import { HUMAN_SEAT } from './store';

/** The photographed hand: 6-6, 6-1, 5-5, 5-0, 4-3, 3-2, 2-1. */
export const DROPPED_HAND: readonly DominoId[] = [
  '66', '61', '55', '50', '43', '32', '21',
];

/**
 * A live game holding the dropped hand, already three passes deep: it is
 * your turn and pass is not on the menu. The other 21 dominoes are dealt
 * from the seed so the hand can be rerun against different tables.
 */
export function droppedBidGame(seed: string | number = 'dropped'): GameState {
  const rest = ALL_DOMINO_IDS.filter((id) => !DROPPED_HAND.includes(id));
  const others = shuffled(rest, mulberry32(toSeed(seed)));
  const dealt = [
    DROPPED_HAND,
    others.slice(0, 7),
    others.slice(7, 14),
    others.slice(14, 21),
  ];
  let g = newDealtGame(PLUNGE_CONFIG, dealt, HUMAN_SEAT);
  for (let i = 0; i < 3; i++) {
    g = applyAction(g, { type: 'bid', bid: { kind: 'pass' } });
  }
  return g;
}
