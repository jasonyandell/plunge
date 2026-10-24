import type { GameState, Seat } from '../engine';
import { bidLabel, contractLabel } from './store';

/** The auction choice stays beside your hand until the next deal or an undo. */
export function YourBid({ g, seat }: { g: GameState; seat: Seat }) {
  const bid = g.bids.find(b => b.seat === seat)?.bid;
  const label = g.declarer === seat && g.contract
    ? `Bid ${contractLabel(g.contract)}`
    : bid ? bid.kind === 'pass' ? 'Passed' : `Bid ${bidLabel(bid)}` : null;
  return label ? <span class="bubble your-bid">{label}</span> : null;
}
