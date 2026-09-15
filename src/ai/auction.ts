/** Auction policy at the table boundary. Rust compares declarations using only
 * this bidder's own hand. The engine owns the bid ladder and validates actions. */
import { legalActions, highBid, teamOf, type Action, type GameState, type Seat } from '../engine';
import { NATIVE_TABLE, api, nativeSeed } from './native';
import { tileOfId, waltContractBid, waltDeclarationOf } from './walt/requests';
import { runAuction } from './phone/client';

export interface AuctionRequest { hand: number[]; seat: number; bid: number; seed: number }
export interface AuctionCall { auction: AuctionRequest; budget_ms: number; worlds?: number }
export interface AuctionSurvey extends AuctionRequest {
  schema: 'walt-auction-v1'; decl: number; eligible: boolean;
  prices: [number,string,string][]; worlds: number; route: string; elapsed_us: number;
  interruption?: string;
}
export interface AuctionDecision { key: string; action: Action; survey: AuctionSurvey | null }
export const AUCTION_BUDGET_MS=4500;

export function auctionKey(g: GameState, gameId: string): string {
  return JSON.stringify([gameId,g.handNumber,g.phase,g.turn,g.bids,g.contract,g.hands[g.turn ?? 0]]);
}
function target(action: Action | undefined): number | null {
  return !action || action.type !== 'bid' || action.bid.kind === 'pass' ? null
    : action.bid.kind === 'points' ? action.bid.value : action.bid.special ? null : 42;
}
export function auctionRequest(g: GameState, gameId: string): AuctionRequest {
  if (g.turn === null || !['bidding','declaring'].includes(g.phase)) throw new Error('No auction decision here.');
  const bid=g.phase==='declaring' ? waltContractBid(g.contract) : target(legalActions(g).find(a=>target(a)!==null)!);
  if (bid===null) throw new Error('This contract is outside straight 42.');
  return {hand:g.hands[g.turn]!.map(tileOfId).sort((a,b)=>a-b),seat:g.turn,bid,seed:nativeSeed(gameId,g.handNumber)};
}
function sameRequest(a: AuctionRequest,b: AuctionRequest): boolean {
  return a.seat===b.seat && a.bid===b.bid && a.seed===b.seed && JSON.stringify(a.hand)===JSON.stringify(b.hand);
}
export function checkedSurvey(req: AuctionRequest,s: AuctionSurvey): AuctionSurvey {
  if (s.schema!=='walt-auction-v1' || !sameRequest(req,s) || !waltDeclarationOf(s.decl)
    || typeof s.eligible!=='boolean' || ![0,4,12,40].includes(s.worlds)) throw new Error('Walt returned a mismatched auction.');
  if (s.worlds===0) {
    if (s.eligible || s.prices.length || s.route!=='unpriced-pass') throw new Error('Invalid auction fallback.');
  } else {
    if (s.route!=='priced' || JSON.stringify(s.prices.map(p=>p[0]))!==JSON.stringify([0,1,2,3,4,5,6,7,9])) throw new Error('Incomplete declaration comparison.');
    for (const [,n,d] of s.prices) {
      if (!/^\d{1,18}$/.test(n) || !/^\d{1,18}$/.test(d) || BigInt(d)<=0n || BigInt(n)>BigInt(d)) throw new Error('Invalid auction price.');
    }
    const selected=s.prices.find(p=>p[0]===s.decl)!;
    if (s.prices.some(p=>BigInt(p[1])*BigInt(selected[2])>BigInt(selected[1])*BigInt(p[2]))) throw new Error('Auction choice disagrees with prices.');
    if (s.eligible !== (BigInt(selected[1])*4n>=BigInt(selected[2])*3n)) throw new Error('Auction threshold disagrees.');
  }
  return s;
}

export async function auctionMove(g: GameState, seat: Seat, gameId: string, previous?: AuctionSurvey, signal?: AbortSignal): Promise<AuctionDecision> {
  if (g.turn!==seat) throw new Error('Not this bidder’s turn.');
  const key=auctionKey(g,gameId), actions=legalActions(g);
  const pass=actions.find(a=>a.type==='bid'&&a.bid.kind==='pass');
  const high=highBid(g.bids);
  if (g.phase==='bidding' && pass && high && teamOf(high.seat)===teamOf(seat)) return {key,action:pass,survey:null};
  const request=auctionRequest(g,gameId);
  const survey=previous && sameRequest(request,previous) ? checkedSurvey(request,previous)
    : checkedSurvey(request,await (NATIVE_TABLE
      ? api<AuctionSurvey>('auction',{auction:request,budget_ms:AUCTION_BUDGET_MS},8500,signal)
      : runAuction({auction:request,budget_ms:AUCTION_BUDGET_MS},signal)));
  let action: Action | undefined;
  if (g.phase==='declaring') {
    const decl=waltDeclarationOf(survey.decl)!;
    action=actions.find(a=>a.type==='declare' && JSON.stringify(a.decl)===JSON.stringify(decl));
  } else if (!survey.eligible && pass) action=pass;
  else action=actions.find(a=>target(a)===request.bid);
  if (!action) throw new Error('No legal auction action.');
  return {key,action,survey};
}
