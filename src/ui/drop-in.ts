/**
 * Scratch: a real hand from the kitchen table, dropped on the player.
 *
 * Open the app with #drop and you shook, Earl, Gran and Ruby all pass,
 * and under the house rule the bid lands on you — at least 30, no
 * passing out of it. The payload after #drop= names the hand and the
 * deal of the other three (see parseDrop):
 *
 *   #drop                        the photographed hand
 *   #drop=table-b                same hand, the other seats dealt anew
 *   #drop=66615550433221         any hand, "65"-style ids as in share codes
 *   #drop=66-61-55-50-43-32-21   dashes or commas between dominoes are fine
 *   #drop=66615550433221.tbl2    a hand and a deal seed together
 */

import {
  ALL_DOMINO_IDS, type DominoId, type GameState, type Pip,
  PLUNGE_CONFIG, applyAction, dom, idOf, mulberry32, newDealtGame, shuffled,
  toSeed,
} from '../engine';
import { HUMAN_SEAT } from './store';

/** The photographed hand: 6-6, 6-1, 5-5, 5-0, 4-3, 3-2, 2-1. */
export const DROPPED_HAND: readonly DominoId[] = [
  '66', '61', '55', '50', '43', '32', '21',
];

export interface DropSpec {
  readonly hand: readonly DominoId[];
  readonly seed: string;
}

const SEED_RE = /^[a-zA-Z0-9_-]{1,60}$/;

/** Seven dominoes as concatenated two-digit ids ("56" and "65" both work). */
function parseHand(text: string): DominoId[] | null {
  const digits = text.replace(/[-,]/g, '');
  if (!/^[0-6]{14}$/.test(digits)) return null;
  const ids: DominoId[] = [];
  for (let i = 0; i < 14; i += 2) {
    ids.push(idOf(dom(Number(digits[i]) as Pip, Number(digits[i + 1]) as Pip)));
  }
  return new Set(ids).size === 7 ? ids : null;
}

/** Fourteen digits (separators aside) is a hand attempt, valid or not. */
function looksLikeHand(text: string): boolean {
  return /^[0-9,-]+$/.test(text) && text.replace(/[-,]/g, '').length === 14;
}

/**
 * The payload of a #drop link (the text after "="): a hand, a seed, or
 * "<hand>.<seed>". Anything that isn't shaped like seven dominoes is taken
 * as a seed for the photographed hand, so old #drop=<seed> links keep
 * working. Returns null when the link cannot be read — including a
 * fourteen-digit hand with a bad pip or a repeated domino, which reads
 * better as an error than as a silent seed.
 */
export function parseDrop(token: string | undefined): DropSpec | null {
  if (token === undefined || token === '') {
    return { hand: DROPPED_HAND, seed: 'dropped' };
  }
  const dot = token.indexOf('.');
  if (dot >= 0) {
    const hand = parseHand(token.slice(0, dot));
    const seed = token.slice(dot + 1);
    return hand && SEED_RE.test(seed) ? { hand, seed } : null;
  }
  if (looksLikeHand(token)) {
    const hand = parseHand(token);
    return hand ? { hand, seed: 'dropped' } : null;
  }
  return SEED_RE.test(token) ? { hand: DROPPED_HAND, seed: token } : null;
}

/**
 * A live game holding the dropped hand, already three passes deep: it is
 * your turn and pass is not on the menu. The other 21 dominoes are dealt
 * from the seed so the hand can be rerun against different tables.
 */
export function droppedBidGame(
  seed: string | number = 'dropped',
  hand: readonly DominoId[] = DROPPED_HAND,
): GameState {
  const yours = [...hand].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const rest = ALL_DOMINO_IDS.filter((id) => !yours.includes(id));
  const others = shuffled(rest, mulberry32(toSeed(seed)));
  const dealt = [
    yours,
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
