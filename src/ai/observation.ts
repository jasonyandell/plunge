/**
 * The information set: everything a seat may legally know, and nothing more.
 *
 * AI code never reads `state.hands[other]` or `state.dealt`. All knowledge
 * flows through this `Observation`, built here (and only here) from
 * `(state, seat)`:
 *
 *   - the seat's own remaining hand,
 *   - public state: bids, contract, declaration, trick rules, the current
 *     trick, completed tricks, points, marks, seating roles,
 *   - derived public inference:
 *       `unseen`    — dominoes not in my hand and not yet played,
 *       `handSizes` — remaining hand sizes (from the play history),
 *       `voids`     — led suits each seat has provably shown out of
 *                     (failure to follow ⇒ void, and hands only shrink).
 *
 * Hard's determinization samples hidden hands ONLY from `unseen`, subject to
 * `handSizes` and `voids` — so cheating is impossible by construction: the
 * hidden hands simply are not present in this object.
 */

import {
  ALL_DOMINO_IDS,
  type CompletedTrick,
  type Contract,
  type Declaration,
  type DominoId,
  type GameConfig,
  type GameState,
  type Phase,
  type PlayRecord,
  type Seat,
  type SeatBid,
  type TrickRules,
  follows,
  fromId,
  ledSuitOf,
} from '../engine';

export interface Observation {
  readonly seat: Seat;
  /** My own remaining hand — the only hand in this object. */
  readonly hand: readonly DominoId[];

  // ----- public state -----
  readonly config: GameConfig;
  readonly phase: Phase;
  readonly marks: readonly [number, number];
  readonly handNumber: number;
  readonly shaker: Seat;
  readonly bids: readonly SeatBid[];
  readonly turn: Seat | null;
  readonly declarer: Seat | null;
  readonly contract: Contract | null;
  readonly declaration: Declaration | null;
  readonly rules: TrickRules | null;
  readonly sittingOut: Seat | null;
  readonly forcedBid: boolean;
  readonly leader: Seat | null;
  readonly currentTrick: readonly PlayRecord[];
  readonly tricks: readonly CompletedTrick[];
  readonly points: readonly [number, number];

  // ----- derived public inference -----
  /** Remaining hand sizes by seat (mine included), from the play history. */
  readonly handSizes: readonly [number, number, number, number];
  /** Dominoes neither in my hand nor yet played: union of the hidden hands. */
  readonly unseen: readonly DominoId[];
  /** voids[seat][ledSuit 0..7] = seat has provably no domino of that suit. */
  readonly voids: readonly (readonly boolean[])[];
}

/** Build the information set for `seat`. The only reads of hidden state are
 *  `state.hands[seat]` (my own hand); everything else is public. */
export function observe(state: GameState, seat: Seat): Observation {
  const hand = [...state.hands[seat]!];

  const playedBy = [0, 0, 0, 0];
  const seen = new Set<DominoId>(hand);
  const allTricks: (readonly PlayRecord[])[] = [
    ...state.tricks.map((t) => t.plays),
    state.currentTrick,
  ];
  for (const plays of allTricks) {
    for (const p of plays) {
      playedBy[p.seat] = playedBy[p.seat]! + 1;
      seen.add(p.domino);
    }
  }
  const unseen = ALL_DOMINO_IDS.filter((id) => !seen.has(id));

  const handSizes = [0, 1, 2, 3].map((s) =>
    s === seat
      ? hand.length
      : s === state.sittingOut
        ? 7 // the sat-out partner keeps all 7, face down
        : 7 - playedBy[s]!,
  ) as unknown as readonly [number, number, number, number];

  // Void inference: a failure to follow proves a (permanent) void.
  const voids: boolean[][] = [0, 1, 2, 3].map(() => new Array<boolean>(8).fill(false));
  const rules = state.rules;
  if (rules && state.contract?.kind !== 'sevens') {
    for (const plays of allTricks) {
      const first = plays[0];
      if (!first) continue;
      const led = ledSuitOf(fromId(first.domino), rules);
      for (let i = 1; i < plays.length; i++) {
        const p = plays[i]!;
        if (!follows(fromId(p.domino), led, rules)) voids[p.seat]![led] = true;
      }
    }
  }

  return {
    seat,
    hand,
    config: state.config,
    phase: state.phase,
    marks: state.marks,
    handNumber: state.handNumber,
    shaker: state.shaker,
    bids: state.bids,
    turn: state.turn,
    declarer: state.declarer,
    contract: state.contract,
    declaration: state.declaration,
    rules,
    sittingOut: state.sittingOut,
    forcedBid: state.forcedBid,
    leader: state.leader,
    currentTrick: state.currentTrick,
    tricks: state.tricks,
    points: state.points,
    handSizes,
    unseen,
    voids,
  };
}
