import { legalActions, type Action, type Bid, type GameState } from '../engine';

const oneMark = (b: Bid) => b.kind === 'points' || (b.kind === 'marks' && b.value === 1 && !b.special);

/** The last bidder has nobody left to outbid, so any one-mark bid above the
 * cheapest legal one only raises the bar for the same mark. People may still
 * overbid; computer players and hints take the cheapest. Higher marks and
 * specials pay more and stay as chosen. */
export function cheapestLastBid(g: GameState, action: Action): Action {
  if (g.phase !== 'bidding' || g.bids.length !== 3 || action.type !== 'bid' || !oneMark(action.bid)) return action;
  return legalActions(g).find(a => a.type === 'bid' && oneMark(a.bid)) ?? action;
}
