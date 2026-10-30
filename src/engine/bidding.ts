/**
 * The bid ladder (docs/RULES.md §3): 30–41, 42 (= 1 mark), then whole marks.
 * Opening cap 2 marks; above 2 marks only +1-mark raises — except Plunge,
 * the sole legal jump.
 */

import { doublesIn } from './dominoes';
import {
  type Bid, type GameState, type SeatBid, PASS,
} from './types';

export const MIN_POINTS_BID = 30;
export const MAX_POINTS_BID = 41;
export const PLUNGE_DOUBLES_REQUIRED = 4;
export const SPLASH_DOUBLES_REQUIRED = 3;

/** Total order over bids: any marks bid beats any points bid. */
export function bidStrength(bid: Bid): number {
  switch (bid.kind) {
    case 'pass': return 0;
    case 'points': return bid.value;
    case 'marks': return MAX_POINTS_BID + bid.value; // 1 mark = 42
  }
}

export function bidsEqual(a: Bid, b: Bid): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'pass' || b.kind === 'pass') return a.kind === b.kind;
  if (a.value !== b.value) return false;
  const sa = a.kind === 'marks' ? a.special : undefined;
  const sb = b.kind === 'marks' ? b.special : undefined;
  return sa === sb;
}

export function highBid(bids: readonly SeatBid[]): SeatBid | null {
  let best: SeatBid | null = null;
  for (const sb of bids) {
    if (sb.bid.kind === 'pass') continue;
    if (!best || bidStrength(sb.bid) > bidStrength(best.bid)) best = sb;
  }
  return best;
}

/**
 * Is the current bidder the shaker, forced to bid after three passes?
 * Only under a forced-bid config; under 'reshake' the hand is thrown in instead.
 */
export function isForcedBidTurn(state: GameState): boolean {
  return (
    state.config.allPass !== 'reshake' &&
    state.bids.length === 3 &&
    state.bids.every((b) => b.bid.kind === 'pass')
  );
}

/** All legal bids for the player on turn during the bidding phase. */
export function legalBids(state: GameState): Bid[] {
  if (state.phase !== 'bidding' || state.turn === null) return [];
  const cfg = state.config;
  const hand = state.hands[state.turn]!;
  const cur = highBid(state.bids);
  const curStr = cur ? bidStrength(cur.bid) : 0;
  const curMarks = cur && cur.bid.kind === 'marks' ? cur.bid.value : 0;
  const doubles = doublesIn(hand);
  const forced = isForcedBidTurn(state);

  const out: Bid[] = [];
  if (!forced) out.push(PASS);

  // Points bids 30–41, strictly above the current high bid.
  for (let v = Math.max(MIN_POINTS_BID, curStr + 1); v <= MAX_POINTS_BID; v++) {
    out.push({ kind: 'points', value: v });
  }

  // Plain marks: 1 and 2 freely over anything lower; above 2 only +1 mark.
  for (const m of [1, 2]) {
    if (MAX_POINTS_BID + m > curStr) out.push({ kind: 'marks', value: m });
  }
  if (curMarks >= 2) out.push({ kind: 'marks', value: curMarks + 1 });

  // Splash: ≥3 doubles; fits inside the normal ladder (no jump privilege).
  if (cfg.splash && doubles >= SPLASH_DOUBLES_REQUIRED) {
    const values = cfg.splashMarks === '2or3' ? [2, 3] : [cfg.splashMarks];
    for (const m of values) {
      const ladderOk = m <= 2 ? MAX_POINTS_BID + m > curStr : curMarks === m - 1;
      if (ladderOk) out.push({ kind: 'marks', value: m, special: 'splash' });
    }
  }

  // Plunge: ≥4 doubles. At the default 4 marks it is the sole legal jump:
  // open at 4, jump to 4 over any lower bid, or +1 over an existing plunge-level bid.
  if (cfg.plunge && doubles >= PLUNGE_DOUBLES_REQUIRED) {
    if (cfg.plungeMarks === 4) {
      const m = Math.max(4, curMarks + 1);
      out.push({ kind: 'marks', value: m, special: 'plunge' });
    } else {
      const m = cfg.plungeMarks;
      const ladderOk = m <= 2 ? MAX_POINTS_BID + m > curStr : curMarks === m - 1;
      if (ladderOk) out.push({ kind: 'marks', value: m, special: 'plunge' });
    }
  }

  // Forced shaker may bid 1–2 marks of Nel-O instead of 30 (house option).
  if (forced && cfg.allPass === 'force-30-or-nello' && cfg.nello !== 'off') {
    for (const m of [1, 2]) {
      if (m >= cfg.nelloMinMarks) out.push({ kind: 'marks', value: m, special: 'nello' });
    }
  }

  return out;
}
