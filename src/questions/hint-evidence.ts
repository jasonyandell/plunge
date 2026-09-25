/** Versioned hint evidence. This module also runs in the Cloudflare Worker. */
import { legalActions, legalDominoes, type GameState } from '../engine';
import { observe } from '../ai/observation';
import { playRequestOf, tileOfId, waltContractBid } from '../ai/walt/requests';
import { decisionStats } from '../ai/decision-stats';
import type { AnalysisWorlds, NativeEstimate } from '../ai/native';
import type { BiddingHint } from '../ai/bidding-hint';

export type BookAdvice = Extract<BiddingHint, { kind: 'book' }>;
export interface MoveHintEvidence {
  kind: 'move'; requested_worlds: AnalysisWorlds; choice: number; forced: boolean;
  estimate: NativeEstimate | null; explanation: string; context: string;
}
export interface BookHintEvidence {
  kind: 'bid' | 'trump'; book_id: string; profile: string; policy_bid: 30; threshold: [number, number];
  advice: BookAdvice; explored_target: number; comparison_open: boolean; heading: string; explanation: string;
}
export type HintEvidence = MoveHintEvidence | BookHintEvidence;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 4000;
const integer = (v: unknown, low: number, high: number): v is number => Number.isInteger(v) && (v as number) >= low && (v as number) <= high;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Verify consistency with the captured decision, not the current book or a fresh solve. */
export function validHint(value: unknown, g: GameState, seed: number): HintEvidence {
  const h = value as HintEvidence;
  if (!h || g.turn !== 0 || !text(h.explanation)) throw new Error('Invalid hint.');
  if (h.kind === 'move') {
    if (g.phase !== 'playing' || ![40,160,500].includes(h.requested_worlds) || !text(h.context)) throw new Error('Invalid move hint.');
    const legal = legalDominoes(g).map(tileOfId);
    if (!legal.includes(h.choice) || h.forced !== (legal.length === 1)) throw new Error('Hint names an illegal choice.');
    if (h.forced) {
      if (h.estimate !== null) throw new Error('Forced hints do not have sampled scores.');
    } else {
      const e = h.estimate, built = playRequestOf(observe(g, 0), { n: 40, n0: 8 });
      if (!e || !built || e.schema !== 'plunge-estimate-v1' || !hash(e.id)
        || typeof e.created !== 'string' || !Number.isFinite(Date.parse(e.created))
        || e.identity?.player?.n !== h.requested_worlds || !e.response) throw new Error('Invalid saved hint scores.');
      const expected = { ...(built.contract ? {contract:built.contract} : {}), decl: built.decl, bid: built.bid, bidder: built.bidder, seat: built.seat, hand: built.hand, plays: built.plays, seed };
      for (const key of ['contract','decl','bid','bidder','seat','hand','plays','seed'] as const) {
        if (!same(e.identity.request?.[key], expected[key])) throw new Error('Hint scores belong to another decision.');
      }
      const r = e.response;
      if (built.contract && (r.contract !== built.contract || r.inactive !== g.sittingOut)) throw new Error('Hint contract disagrees with the table.');
      if (r.choice !== h.choice || r.leader !== g.leader || !same(r.points, g.points)
        || !Array.isArray(r.phases) || r.phases.length > 100
        || !r.phases.every(p => p && typeof p.name === 'string' && typeof p.status === 'string')
        || !Number.isFinite(r.elapsed_us)) throw new Error('Hint scores disagree with the table.');
      const stats = decisionStats(r, expected, legal);
      if (!stats || stats.worlds > h.requested_worlds || !stats.options.some(p => p.tile === h.choice && p.best)) {
        throw new Error('Hint is missing its completed comparison.');
      }
    }
    return { kind: h.kind, requested_worlds: h.requested_worlds, choice: h.choice, forced: h.forced,
      estimate: h.estimate, explanation: h.explanation, context: h.context };
  }
  if (!['bid','trump'].includes(h.kind) || g.phase !== (h.kind === 'bid' ? 'bidding' : 'declaring')
    || !hash(h.book_id) || typeof h.profile !== 'string' || h.profile.length > 200 || h.policy_bid !== 30
    || !same(h.threshold, [4,5]) || !integer(h.explored_target,30,42) || typeof h.comparison_open !== 'boolean'
    || !text(h.heading)) throw new Error('Invalid bidding hint.');
  const a = h.advice;
  if (!a || a.kind !== 'book' || !integer(a.target,30,42)
    || !['bid','pass','partner','forced','declare'].includes(a.reason)
    || (a.ceiling !== null && !integer(a.ceiling,30,42))
    || !legalActions(g).some(action => same(action, a.action))
    || (h.kind === 'trump' && (a.reason !== 'declare' || a.target !== waltContractBid(g.contract)))
    || (h.kind === 'bid' && a.action.type !== 'bid')
    || !Array.isArray(a.panels) || !same(a.panels.map(p => p?.decl),[0,1,2,3,4,5,6,7,9])) throw new Error('Bidding hint disagrees with the auction.');
  for (const p of a.panels) {
    if (!integer(p.games,1,10000000) || !Array.isArray(p.tails) || p.tails.length !== 13
      || p.tails.some((n: number,i: number) => !integer(n,0,p.games) || (i > 0 && n > p.tails[i-1]!))
      || !['screened','resolved','capped-unsettled','audit-complete'].includes(p.allocation)
      || typeof p.audit !== 'boolean' || !Array.isArray(p.uncertain) || p.uncertain.some((n: number) => !integer(n,30,42))) throw new Error('Invalid recorded-game counts.');
  }
  if (!a.panels.some(p => same(p,a.panel)) || (a.minimum !== null && !legalActions(g).some(action => action.type === 'bid' && same(action.bid,a.minimum)))) {
    throw new Error('Invalid bidding hint comparison.');
  }
  return { kind: h.kind, book_id: h.book_id, profile: h.profile, policy_bid: h.policy_bid, threshold: h.threshold,
    advice: { kind: a.kind, action: a.action, reason: a.reason, target: a.target, minimum: a.minimum,
      panel: a.panel, panels: a.panels, ceiling: a.ceiling },
    explored_target: h.explored_target, comparison_open: h.comparison_open, heading: h.heading, explanation: h.explanation };
}
