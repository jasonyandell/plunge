// Baseline card players for the spades h2h. They import the SAME engine the
// page uses. All values are exact integers (engine.payoff).
//
//   random  - uniform legal card
//   rule    - engine.ruleMove (standard heuristics)
//   flatmc  - flat Monte Carlo: n worlds from the decider's chair; every legal
//             option is scored by rule-player rollouts in each world; best sum.
//   pimc    - PIMC: n worlds; every option is scored per world by a
//             perfect-information alpha-beta solve of the same integer payoff,
//             exact to the end of the hand once <= exactTricks tricks remain,
//             otherwise searched `depthTricks` tricks deep with rule-player
//             rollouts at the leaves. Best sum over worlds (strategy fusion and
//             clairvoyant opponents included, as in standard PIMC).

import {
  P_NTRICKS, P_TLEN, P_WON, P_LEADER, P_BROKEN, P_PLAYED, toMove, payoff, privateHand, options,
  legal, play, sample, ruleMove, rollout, makeRng, mix, randomMove,
} from '../../public/lab/spades/engine.js';

export function randomPlayer(seed) {
  const rng = makeRng(seed);
  return (h, p) => randomMove(h, p, rng);
}
export const rulePlayer = () => (h, p) => ruleMove(h, p);

const rolloutRule = (d, p) => rollout(d, p);

export function flatMcPlayer({ n = 64 } = {}, seed = 1) {
  return (h, p, seat) => {
    const opts = options(h, p);
    if (opts.length === 1) return opts[0];
    const rng = makeRng(mix(seed, p[P_NTRICKS] * 4 + p[P_TLEN] + 1000 * seat));
    const deals = sample(seat, h, p, n, rng);
    const max = (seat & 1) === 0;
    let best = opts[0], bv = 0, first = true;
    for (const a of opts) {
      const q = play(p, a);
      let v = 0;
      for (const d of deals) v += rolloutRule(d, q);
      if (first || (max ? v > bv : v < bv)) {
        best = a;
        bv = v;
        first = false;
      }
    }
    return best;
  };
}

const BIG = 1 << 30; // integer sentinel

// ---------------------------------------------------------------- PI solver
// Alpha-beta over the integer payoff with every hand known. TT at trick
// boundaries keyed by (all remaining holdings, leader, team-0 tricks, broken).
class Solver {
  constructor(depthTricks, exactTricks) {
    this.depthTricks = depthTricks;
    this.exactTricks = exactTricks;
    this.tt = new Map();
    this.nodes = 0;
  }
  // value of p for world d (holdings at sampling time), team 0 maximizes
  value(d, p, alpha, beta, stopTrick) {
    this.nodes++;
    if (p[P_NTRICKS] === 13) return payoff(p);
    const atBoundary = p[P_TLEN] === 0;
    if (atBoundary && p[P_NTRICKS] >= stopTrick) return rolloutRule(d, p);
    let key = null;
    if (atBoundary) {
      const h = [];
      for (let s = 0; s < 16; s++) h.push(d[s] & ~p[P_PLAYED + (s & 3)]);
      key = h.join(',') + '|' + p[P_LEADER] + '|' + p[P_WON] + '|' + p[P_BROKEN] + '|' + stopTrick;
      const e = this.tt.get(key);
      if (e) {
        if (e.lo === e.hi) return e.lo;
        if (e.lo >= beta) return e.lo;
        if (e.hi <= alpha) return e.hi;
        if (e.lo > alpha) alpha = e.lo;
        if (e.hi < beta) beta = e.hi;
      }
    }
    const seat = toMove(p);
    const max = (seat & 1) === 0;
    const opts = options(privateHand(d, seat, p), p);
    const a0 = alpha, b0 = beta;
    let best = max ? -BIG : BIG;
    // simple ordering: high cards first for the side to move (tends to cut)
    for (let i = opts.length - 1; i >= 0; i--) {
      const v = this.value(d, play(p, opts[i]), alpha, beta, stopTrick);
      if (max) {
        if (v > best) best = v;
        if (best > alpha) alpha = best;
      } else {
        if (v < best) best = v;
        if (best < beta) beta = best;
      }
      if (alpha >= beta) break;
    }
    if (key !== null) {
      const e = this.tt.get(key) || { lo: -BIG, hi: BIG };
      if (best <= a0) e.hi = Math.min(e.hi, best);
      else if (best >= b0) e.lo = Math.max(e.lo, best);
      else e.lo = e.hi = best;
      this.tt.set(key, e);
    }
    return best;
  }
}

export function pimcPlayer({ n = 16, depthTricks = 2, exactTricks = 5 } = {}, seed = 1, stats = null) {
  return (h, p, seat) => {
    const opts = options(h, p);
    if (opts.length === 1) return opts[0];
    const rng = makeRng(mix(seed, p[P_NTRICKS] * 4 + p[P_TLEN] + 1000 * seat));
    const deals = sample(seat, h, p, n, rng);
    const max = (seat & 1) === 0;
    const left = 13 - p[P_NTRICKS];
    // finish the current trick, then search depthTricks more (or to the end)
    const stopTrick = left <= exactTricks ? 13 : p[P_NTRICKS] + (p[P_TLEN] ? 1 : 0) + depthTricks;
    const sums = new Array(opts.length).fill(0);
    for (const d of deals) {
      const S = new Solver(depthTricks, exactTricks);
      for (let i = 0; i < opts.length; i++) sums[i] += S.value(d, play(p, opts[i]), -BIG, BIG, stopTrick);
      if (stats) stats.nodes += S.nodes;
    }
    let best = 0;
    for (let i = 1; i < opts.length; i++) if (max ? sums[i] > sums[best] : sums[i] < sums[best]) best = i;
    return opts[best];
  };
}

export { legal };
