/** Choose only premeasured deals. The auction itself still looks up just its own hand. */
import { mulberry32, newGame, shuffled, toSeed, type GameState } from '../engine';
import { BID_BOOK } from './bid-book';

export function catalogueSeed(seed: string, handNumber: number): number {
  const n=BID_BOOK.seeds.length, cycle=Math.floor((handNumber-1)/n);
  return shuffled(BID_BOOK.seeds,mulberry32((toSeed(seed)^Math.imul(cycle+1,0x9e3779b9))>>>0))[(handNumber-1)%n]!;
}
export function catalogueDeal(game: GameState, seed: string): GameState {
  if (game.phase!=='bidding' || game.bids.length || game.tricks.length) throw new Error('Only replace a fresh deal.');
  const dealt=newGame(game.config,catalogueSeed(seed,game.handNumber));
  // Keep match score, shaker rotation, hand number and ordinary RNG progression.
  return {...game,hands:dealt.hands,dealt:dealt.dealt};
}
