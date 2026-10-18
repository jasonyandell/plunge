import type { GameState, Seat } from '../engine';
import { auctionMove, type AuctionEvidence, type AuctionEvaluator } from './auction';
import { zebAuctionMove } from './zeb';
import { effectivePlayer, type PlayerId } from './players';

const auctions: Record<PlayerId, typeof auctionMove> = {
  'native-partner': auctionMove,
  'native-l1': auctionMove,
  zeb: (g, seat, gameId, previous, signal) => zebAuctionMove(g, seat, gameId, previous, signal),
};
export function computerAuction(model: unknown, g: GameState, seat: Seat, gameId: string,
  previous?: AuctionEvidence, signal?: AbortSignal, evaluate?: AuctionEvaluator) {
  return auctions[effectivePlayer(model, g)](g, seat, gameId, previous, signal, evaluate);
}
