/** Instant, read-only auction advice from recorded complete games. No solver fallback. */
import { legalBids, type Action, type Bid, type GameState } from '../engine';
import { auctionRequest, partnerAuctionPass } from './auction';
import { bestPanel, qualifies, type PlayedPanel } from './bid-book';
import { bookAuction } from './book-auction';
import { waltContractBid } from './walt/requests';

export type BiddingHint = {
  kind: 'book'; action: Action; reason: 'bid' | 'pass' | 'partner' | 'forced' | 'declare';
  target: number; minimum: Bid | null; panel: PlayedPanel; panels: readonly PlayedPanel[];
  /** Highest score clearing the book's observed-frequency cutoff, independent of legal raises. */
  ceiling: number | null;
} | { kind: 'unavailable'; reason: 'missing-hand' | 'unsupported' };

export function bookCeiling(panels: readonly PlayedPanel[]): number | null {
  for (let target = 42; target >= 30; target--) {
    if (qualifies(bestPanel(panels, target), target)) return target;
  }
  return null;
}

export function getBiddingHint(g: GameState): BiddingHint {
  if (g.turn !== 0 || !['bidding', 'declaring'].includes(g.phase)) throw new Error('Hints are for your auction turn.');
  if (g.config.noTrumpDoubles !== 'high'
    || (g.phase === 'declaring' && (waltContractBid(g.contract) === null || g.declarer !== g.turn))) {
    return { kind: 'unavailable', reason: 'unsupported' };
  }
  // The same request builder and choice rule as live bidding. Book lookup uses only hand + seat.
  const result = bookAuction(g, auctionRequest(g, 'bidding-hint'));
  if (!result) return { kind: 'unavailable', reason: 'missing-hand' };
  const partnerPass = partnerAuctionPass(g), { survey } = result;
  const action = partnerPass ?? result.action;
  const reason = g.phase === 'declaring' ? 'declare' : partnerPass ? 'partner' : survey.forced ? 'forced'
    : action.type === 'bid' && action.bid.kind === 'pass' ? 'pass' : 'bid';
  return {
    kind: 'book', action, reason, target: survey.bid,
    minimum: legalBids(g).find(b => b.kind === 'points' || (b.kind === 'marks' && !b.special)) ?? null,
    panel: survey.panels.find(p => p.decl === survey.decl)!, panels: survey.panels,
    ceiling: bookCeiling(survey.panels),
  };
}
