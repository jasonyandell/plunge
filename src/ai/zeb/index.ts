import { chooseBid, type Forecast, type PositionRequest } from '@jasonyandell/zeb';
import { legalActions, type Action, type GameState, type Seat } from '../../engine';
import { auctionKey, auctionRequest, partnerAuctionPass, type AuctionDecision, type AuctionEvidence, type AuctionRequest } from '../auction';
import { checkedAction, requestOf, type NativeReceipt, type NativeRequest, type NativeEstimate } from '../native';
import { waltDeclarationOf, waltDeclId } from '../walt/requests';
import { digest, putReceipt, putEstimate } from '../phone/records';
import { BUILD_ID } from '../../ui/update';
import { runZeb, type ZebForecast, type ZebPlay } from './client';

import { PLAYERS } from '../players';
export const ZEB_PLAYER = PLAYERS.zeb.receiptName;
export const ZEB_WORLDS = 160;
// Mobile forecasts are noisier than the published 512-world calibration.
export const ZEB_CUTOFF = 0.85;
export interface ZebSurvey extends AuctionRequest {
  schema: 'zeb-auction-v1'; decl: number; worlds: number; cutoff: number;
  forecast: Forecast[]; version: string; net: string; elapsed_us: number;
}

/** Construct a worker payload from only the actor's original hand and public play. */
export function zebPosition(request: NativeRequest, worlds = ZEB_WORLDS): PositionRequest {
  if (request.contract === 'nello' || request.decl === 8) throw new Error('Zeb does not play Nel-O.');
  const plays: [number, number][] = [];
  for (let i = 0; i < request.plays.length; i += 2) plays.push([request.plays[i]!, request.plays[i + 1]!]);
  return { decl: request.decl, bid: request.bid, bidder: request.bidder, seat: request.seat,
    hand: [...request.hand], plays, seed: request.seed, worlds, reading: true };
}

export function zebAuctionAction(g: GameState, forecast: Forecast[]): Action {
  const actions = legalActions(g), pass = actions.find(a => a.type === 'bid' && a.bid.kind === 'pass');
  const partnerPass = partnerAuctionPass(g);
  if (partnerPass) return partnerPass;
  if (g.phase === 'declaring') {
    const bid = g.contract?.kind === 'points' ? g.contract.value : 42;
    const candidates = forecast.filter(f => actions.some(a => a.type === 'declare' && JSON.stringify(a.decl) === JSON.stringify(waltDeclarationOf(f.decl))));
    const best = candidates.reduce<Forecast | null>((best, f) => !best || f.pmake[bid - 30]! > best.pmake[bid - 30]! ? f : best, null);
    const action = best && actions.find(a => a.type === 'declare' && JSON.stringify(a.decl) === JSON.stringify(waltDeclarationOf(best.decl)));
    if (!action) throw new Error('Zeb has no legal declaration.');
    return action;
  }
  // The hand-only bidder takes at most one mark. No uncalibrated mark escalation.
  const target = (a: Action) => a.type !== 'bid' || a.bid.kind === 'pass' || (a.bid.kind === 'marks' && (a.bid.special || a.bid.value !== 1))
    ? null : a.bid.kind === 'points' ? a.bid.value : 42;
  const choices = actions.filter(a => target(a) !== null);
  if (!choices.length && pass) return pass;
  const need = target(choices[0]!)!;
  const chosen = chooseBid(forecast, { need, cutoff: ZEB_CUTOFF });
  const action = chosen && choices.find(a => target(a) === chosen.bid);
  if (action) return action;
  if (pass) return pass;
  if (choices[0]) return choices[0]; // the engine's forced minimum
  throw new Error('Zeb has no legal bid.');
}

export async function zebAuctionMove(g: GameState, seat: Seat, gameId: string, previous?: AuctionEvidence, signal?: AbortSignal,
  evaluate = async (request: AuctionRequest): Promise<ZebForecast> => await runZeb({kind:'forecast',request:{hand:request.hand,seed:request.seed,worlds:ZEB_WORLDS}},signal) as ZebForecast): Promise<AuctionDecision> {
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  if (g.turn !== seat) throw new Error('Not this bidder’s turn.');
  const key = auctionKey(g, gameId), pass = partnerAuctionPass(g);
  if (pass) return { key, action: pass, survey: null };
  const request = auctionRequest(g, gameId);
  const reused = previous?.schema === 'zeb-auction-v1' && previous.version === PLAYERS.zeb.version && previous.seed === request.seed && previous.seat === seat
    && JSON.stringify(previous.hand) === JSON.stringify(request.hand) ? previous : null;
  const result = reused ? null : await evaluate(request);
  if (result && result.version !== PLAYERS.zeb.version) throw new Error('Zeb package and worker versions differ. Refresh Plunge.');
  const survey: ZebSurvey = reused ? { ...reused, bid: request.bid } : { ...request, schema:'zeb-auction-v1', decl:0, worlds:ZEB_WORLDS,
    cutoff:ZEB_CUTOFF, forecast:result!.value, version:result!.version, net:result!.net, elapsed_us:result!.elapsed_us };
  const action = zebAuctionAction(g, survey.forecast);
  const target = action.type==='bid' && action.bid.kind==='points' ? action.bid.value : g.phase==='declaring' ? request.bid : 42;
  const best = survey.forecast.reduce((a,b)=>b.pmake[target-30]!>a.pmake[target-30]! ? b : a);
  return { key, action, survey:{...survey,decl:action.type==='declare' ? waltDeclId(action.decl)! : best.decl} };
}

export async function zebMove(g: GameState, seat: Seat, gameId: string, signal?: AbortSignal, deeper = false): Promise<NativeReceipt> {
  const request = requestOf(g, seat, gameId), worlds = deeper ? 512 : ZEB_WORLDS;
  const position = zebPosition(request, worlds);
  const result = await runZeb({kind:'play',request:position},signal) as ZebPlay;
  if (result.version !== PLAYERS.zeb.version) throw new Error('Zeb package and worker versions differ. Refresh Plunge.');
  const identity = { request, player:{name:ZEB_PLAYER}, game_id:gameId, hand_number:g.handNumber,
    implementation:{package:'@jasonyandell/zeb',version:result.version,net:result.net,worlds,reading:true,app:BUILD_ID} };
  const response = { choice:result.value.tile, legal:result.value.forced ? [result.value.tile] : result.value.q.map(([tile])=>tile),
    leader:g.leader!,points:[...g.points],elapsed_us:result.elapsed_us,route:result.value.forced?'forced':'zeb',n:worlds,
    zeb_result:result.value };
  const receipt: NativeReceipt = {schema:'plunge-decision-v1',id:await digest({identity,response}),created:new Date().toISOString(),identity,response};
  checkedAction(g,request,receipt);
  if (!await putReceipt(receipt)) { receipt.storage='session'; if(typeof window!=='undefined')window.dispatchEvent(new Event('plunge-history-storage-error')); }
  return receipt;
}

/** Advice is stored as an estimate; it never masquerades as an executed move. */
export async function zebEstimate(g: GameState, gameId: string, worlds: number, signal?: AbortSignal): Promise<NativeEstimate> {
  const request = requestOf(g, g.turn!, gameId);
  const result = await runZeb({ kind: 'play', request: zebPosition(request, worlds) }, signal) as ZebPlay;
  if (result.version !== PLAYERS.zeb.version) throw new Error('Zeb package and worker versions differ. Refresh Plunge.');
  const identity = { request, player: { name: ZEB_PLAYER, n: worlds },
    implementation: { package: PLAYERS.zeb.package, version: result.version, net: result.net, worlds, reading: true, app: BUILD_ID } };
  const response = { choice: result.value.tile, legal: result.value.q.map(([tile]) => tile), leader: g.leader!, points: [...g.points],
    elapsed_us: result.elapsed_us, route: result.value.forced ? 'forced' : 'zeb', n: worlds, zeb_result: result.value };
  const estimate: NativeEstimate = { schema: 'plunge-estimate-v1', id: await digest({ identity, response }),
    created: new Date().toISOString(), identity, response };
  if (!await putEstimate(estimate) && typeof window !== 'undefined') window.dispatchEvent(new Event('plunge-history-storage-error'));
  return estimate;
}
