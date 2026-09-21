/** Reconstruct a past actor's view and read only the evaluation that completed. */
import { legalPlays, type GameState } from '../engine';
import { explainRequestOf } from './review-request';
import { tileOfId } from './walt/requests';
import { requestTile, type NativeRequest } from './native';

export type ReviewSelection = { trick: number; play: number };
export function reviewPosition(g: GameState, sel: ReviewSelection, seed: number) {
  const built = explainRequestOf(g, sel.trick, sel.play);
  if (!built || !g.rules) return null;
  const { decl, bid, bidder, seat, hand, plays } = built.req;
  const request: NativeRequest = { decl, bid, bidder, seat, hand, plays, seed };
  const remaining = new Set(hand);
  for (let i = 1; i < plays.length; i += 2) remaining.delete(plays[i]!);
  const lead = sel.play === 0 ? null : g.tricks[sel.trick]!.plays[0]!.domino;
  const legal = legalPlays([...remaining].map(requestTile), lead, g.rules).map(tileOfId);
  return { request, remaining: [...remaining], legal, played: tileOfId(built.domino) };
}

export function reviewLegal(g: GameState, sel: ReviewSelection): number[] {
  return reviewPosition(g, sel, 0)?.legal ?? [];
}

export { decisionStats, type MoveStats } from './decision-stats';
