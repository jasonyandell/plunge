import { legalActions, type Action, type GameState } from '../engine';
import { waltDeclarationOf } from './walt/requests';
import { BID_BOOK, bestPanel, playedHand, qualifies, type BookAuctionSurvey } from './bid-book';
import type { AuctionRequest } from './auction';

function points(a: Action): number | null {
  return a.type !== 'bid' || a.bid.kind === 'pass' ? null : a.bid.kind === 'points' ? a.bid.value : a.bid.special ? null : 42;
}
/** Own hand + public legal auction only. A missing hand uses the existing live path. */
export function bookAuction(g: GameState, request: AuctionRequest): { action: Action; survey: BookAuctionSurvey } | null {
  const entry = playedHand(request.hand,request.seat); if (!entry) return null;
  const actions=legalActions(g), pass=actions.find(a=>a.type==='bid'&&a.bid.kind==='pass');
  let bid=request.bid, panel=bestPanel(entry.panels,bid), action: Action | undefined;
  if (g.phase === 'declaring') {
    const decl=waltDeclarationOf(panel.decl)!;
    action=actions.find(a=>a.type==='declare'&&JSON.stringify(a.decl)===JSON.stringify(decl));
  } else {
    // Highest supported score; at 42, take the cheapest legal plain-marks bid.
    for (const candidate of actions) {
      const target=points(candidate); if (target===null) continue;
      const p=bestPanel(entry.panels,target);
      if (qualifies(p,target) && (!action || target>bid)) { action=candidate;bid=target;panel=p; }
    }
    if (!action) action=pass ?? actions.find(a=>points(a)===request.bid);
  }
  if (!action) throw new Error('No legal book auction action.');
  return {action,survey:{...request,bid,schema:'plunge-played-auction-v1',book_id:BID_BOOK.source_book,
    profile:BID_BOOK.profile,policy_bid:30,threshold:BID_BOOK.threshold,decl:panel.decl,eligible:qualifies(panel,bid),
    forced:g.phase==='bidding'&&!pass,source_deal_seed:entry.seed,panels:entry.panels}};
}
