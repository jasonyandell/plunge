/**
 * Easy: a beginner. Bids only clearly strong hands (never specials, never
 * marks), names the suit it simply holds most of, and plays a random legal
 * domino. Beatable by a child learning the game.
 */

import {
  type Action,
  type Pip,
  PIPS,
  fromId,
  hasPip,
} from '../engine';
import type { Observation } from './observation';
import { rateDeclarations } from './evaluate';

type BidAction = Extract<Action, { type: 'bid' }>;
type DeclareAction = Extract<Action, { type: 'declare' }>;

function easyBid(obs: Observation, acts: readonly Action[]): Action {
  const bids = acts.filter((a): a is BidAction => a.type === 'bid');
  const pass = bids.find((a) => a.bid.kind === 'pass');
  // "Clearly strong": a hand the evaluator likes a lot — and even then only
  // a minimum bid, never raising past 31.
  const best = rateDeclarations(obs.hand, obs.config)[0]!;
  if (best.score.estTricks >= 5.4) {
    const cheap = bids.find((a) => a.bid.kind === 'points' && a.bid.value <= 31);
    if (cheap) return cheap;
  }
  if (pass) return pass;
  // Forced: take the lowest points bid (or whatever is first).
  return bids.find((a) => a.bid.kind === 'points') ?? bids[0]!;
}

function easyDeclare(obs: Observation, acts: readonly Action[]): Action {
  const decls = acts.filter((a): a is DeclareAction => a.type === 'declare');
  // The pip we hold the most of (ties to the higher pip).
  let bestPip: Pip = 6;
  let bestN = -1;
  for (const p of PIPS) {
    const n = obs.hand.filter((id) => hasPip(fromId(id), p)).length;
    if (n >= bestN) {
      bestN = n;
      bestPip = p;
    }
  }
  return (
    decls.find((a) => a.decl.type === 'pip' && a.decl.pip === bestPip) ?? decls[0]!
  );
}

export function easyAction(
  obs: Observation,
  acts: readonly Action[],
  rand: () => number,
): Action {
  switch (obs.phase) {
    case 'bidding':
      return easyBid(obs, acts);
    case 'declaring':
      return easyDeclare(obs, acts);
    case 'playing':
      return acts[Math.floor(rand() * acts.length)]!;
    default:
      return acts[0]!;
  }
}
