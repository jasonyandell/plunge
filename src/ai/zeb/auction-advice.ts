/** Interpret the saved forecast and chosen action; exploring a target never changes either. */
import type { Forecast } from '@jasonyandell/zeb';
import { highBid, isForcedBidTurn, legalBids, type Action, type GameState } from '../../engine';
import { waltDeclId } from '../walt/requests';
import type { ZebSurvey } from './index';

export function forecastRows(forecasts: readonly Forecast[], target: number): Forecast[] {
  if (!Number.isInteger(target) || target < 30 || target > 42) throw new Error('Forecast targets run from 30 to 42.');
  return [...forecasts].sort((a,b) => b.pmake[target - 30]! - a.pmake[target - 30]! || a.decl - b.decl);
}

export function forecastAdvice(g: GameState, action: Action, survey: ZebSurvey | null) {
  const high = highBid(g.bids);
  const minimum = legalBids(g).find(b => b.kind === 'points' || (b.kind === 'marks' && b.value === 1 && !b.special));
  const minimumTarget = minimum?.kind === 'points' ? minimum.value : minimum ? 42 : null;
  const partner = g.phase === 'bidding' && action.type === 'bid' && action.bid.kind === 'pass' && high?.seat === 2;
  const target = g.phase === 'declaring' ? g.contract?.kind === 'points' ? g.contract.value : 42
    : action.type === 'bid' && action.bid.kind !== 'pass' ? action.bid.kind === 'points' ? action.bid.value : 42
    : partner ? high.bid.kind === 'points' ? high.bid.value : 42 : minimumTarget ?? 42;
  const rows = forecastRows(survey?.forecast ?? [], target);
  const selected = action.type === 'declare' ? rows.find(f => f.decl === waltDeclId(action.decl)) : rows[0];
  const reason = g.phase === 'declaring' ? 'declare' : partner ? 'partner'
    : action.type === 'bid' && action.bid.kind === 'pass' ? minimumTarget === null ? 'marks' : 'pass'
    : isForcedBidTurn(g) ? 'forced' : 'bid';
  return { target, minimumTarget, selected, reason,
    tied: !!selected && rows.filter(f => f.pmake[target - 30] === selected.pmake[target - 30]).length > 1 };
}
