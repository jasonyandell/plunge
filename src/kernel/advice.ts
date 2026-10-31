/** What the computer players advise on the viewer's auction turn, and core's ways to show it.
 * The same panels replay saved questions, so they stay in core. */
import type { GameState, Seat } from '../engine';
import { getBiddingHint, type BiddingHint } from '../ai/bidding-hint';
import { zebAuctionMove } from '../ai/zeb';
import { playerIdentity } from '../ai/players';
import type { ForecastHintEvidence } from '../questions/hint-evidence';
import { forecastCopy } from '../ui/ForecastDetails';

export { BookDetails } from '../ui/BookDetails';
export { ForecastDetails } from '../ui/ForecastDetails';

export type WaltAuctionAdvice = BiddingHint;
export type ZebAuctionAdvice = ForecastHintEvidence;

/** Walt's bidding book for the viewer's hand; `bookSeat` is the viewer's unrotated seat. Throws off the viewer's auction turn. */
export const waltAuctionAdvice = (g: GameState, bookSeat: Seat): WaltAuctionAdvice => getBiddingHint(g, bookSeat);

/** Zeb's forecast for the viewer (seat 0 of `g`), keeping a pass to a partner who holds the bid. */
export async function zebAuctionAdvice(g: GameState, sessionId: string, signal: AbortSignal): Promise<ZebAuctionAdvice> {
  const zeb = await zebAuctionMove(g, 0, sessionId, undefined, signal, undefined, { comparePartnerPass: true });
  const survey = zeb.survey?.schema === 'zeb-auction-v1' ? zeb.survey : null;
  return { kind: g.phase === 'bidding' ? 'bid' : 'trump', source: 'zeb', model: playerIdentity('zeb'), survey, action: zeb.action,
    ...forecastCopy(g, { action: zeb.action, survey }) };
}
