import type { GameState, Seat } from '../engine';
import { bidLabel, contractLabel } from './store';

/** Keep the local player's auction choice, then their winning contract, by their hand. */
export function YourBid({ g, seat }: { g: GameState; seat: Seat }) {
  const bid = g.bids.find(b => b.seat === seat)?.bid;
  const label = g.declarer === seat && g.contract
    ? `Bid ${contractLabel(g.contract)}`
    : g.phase === 'bidding' && bid
      ? bid.kind === 'pass' ? 'Passed' : `Bid ${bidLabel(bid)}`
      : null;
  if (!label) return null;
  return <span class="bubble your-bid">{label}</span>;
}
