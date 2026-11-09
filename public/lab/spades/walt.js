// Walt for spades card play: the card's decide/value ladder with a horizon.
//
// Seven-function interface (engine.js):
//   to_move  -> toMove(public)
//   outcome  -> 13 tricks played ? integer payoff(public) : not done
//   private  -> privateHand(deal, seat, public)
//   legal    -> options(hand, public)  (legal cards, touching-card equivalents merged)
//   play     -> play(public, card)
//   sample   -> sample(seat, hand, public, n, rng)  (own chair: hand sizes, voids)
//   maximizes-> seat & 1 === 0  (payoff is team North/South minus team East/West)
//
// Objective: the zero-sum hand payoff from engine.payoff (amortized-bag hand
// score of my team minus the opponents'), an exact integer summed over deals.
//
// Lawful cost levers: n (live worlds), n0 (worlds per modeled mind), horizon
// (modeled minds / my own chosen moves only for the first `horizon` plies from
// the live decision; beyond it every deal is finished by a rollout of the
// rule-based player or random play), early exit at a max/min node once a move
// reaches the best payoff still possible in every deal, common random numbers
// (all noise is keyed by a deal-independent tag drawn when the deal was sampled).

import {
  P_NTRICKS, P_TLEN, P_LEN, toMove, payoff, payoffRange, privateHand, options, legal,
  play, sample, ruleMove, rollout, makeRng, mix,
} from './engine.js';

export const DEFAULTS = Object.freeze({ level: 1, n: 16, n0: 3, horizon: 4, rollout: 'rule', bottom: 'random' });

const plyOf = (p) => p[P_NTRICKS] * 4 + p[P_TLEN];

function rolloutOf(ctx, d, p) {
  ctx.rollouts++;
  return ctx.rollout === 'random' ? rollout(d, p, makeRng(mix(d.tag, 0x51ed + plyOf(p)))) : rollout(d, p);
}

function decide(ctx, seat, h, p, level, n, depth, rng) {
  const opts = options(h, p);
  if (opts.length === 1) return opts[0];
  const deals = sample(seat, h, p, n, rng); // from seat's own chair only
  const max = (seat & 1) === 0;
  const range = payoffRange(p);
  const ideal = (max ? range[1] : range[0]) * deals.length;
  let best = opts[0], bv = 0, first = true;
  for (const a of opts) {
    const v = value(ctx, seat, play(p, a), deals, level, depth + 1);
    if (first || (max ? v > bv : v < bv)) {
      best = a;
      bv = v;
      first = false;
      if (v === ideal) break;
    }
  }
  if (depth === 0) ctx.rootValue = bv;
  return best;
}

function value(ctx, me, p, deals, level, depth) {
  ctx.nodes++;
  if (p[P_NTRICKS] === 13) return deals.length * payoff(p);
  if (depth >= ctx.horizon) {
    let s = 0;
    for (const d of deals) s += rolloutOf(ctx, d, p);
    return s;
  }
  const seat = toMove(p);
  if (seat === me) {
    // one action for every deal I can't tell apart
    const opts = options(privateHand(deals[0], me, p), p);
    if (opts.length === 1) return value(ctx, me, play(p, opts[0]), deals, level, depth + 1);
    const max = (me & 1) === 0;
    const range = payoffRange(p);
    const ideal = (max ? range[1] : range[0]) * deals.length;
    let bv = 0, first = true;
    for (const a of opts) {
      const v = value(ctx, me, play(p, a), deals, level, depth + 1);
      if (first || (max ? v > bv : v < bv)) {
        bv = v;
        first = false;
        if (v === ideal) break;
      }
    }
    return bv;
  }
  // what does `seat` do in each deal? (decided from its own chair)
  const ply = plyOf(p);
  const acts = [], groups = [];
  const seenH = [], seenA = []; // same holding = same information set = same action
  for (const d of deals) {
    const mine = privateHand(d, seat, p);
    let a = -1;
    if (level === 0) {
      if (ctx.bottom === 'rule') a = ruleMove(mine, p);
      else {
        const l = legal(mine, p);
        a = l.length === 1 ? l[0] : l[makeRng(mix(d.tag, ply * 4 + seat)).int(l.length)];
      }
    } else {
      for (let k = 0; k < seenH.length; k++) {
        const x = seenH[k];
        if (x[0] === mine[0] && x[1] === mine[1] && x[2] === mine[2] && x[3] === mine[3]) {
          a = seenA[k];
          break;
        }
      }
      if (a < 0) {
        a = decide(ctx, seat, mine, p, level - 1, ctx.n0, depth, makeRng(mix(d.tag, ply * 4 + seat)));
        seenH.push(mine);
        seenA.push(a);
      }
    }
    let g = acts.indexOf(a);
    if (g < 0) {
      g = acts.length;
      acts.push(a);
      groups.push([]);
    }
    groups[g].push(d);
  }
  let s = 0;
  for (let g = 0; g < acts.length; g++) s += value(ctx, me, play(p, acts[g]), groups[g], level, depth + 1);
  return s;
}

/** Walt's card for `seat` holding h (4 suit masks) at public state p.
 *  seed: deal-independent noise. Returns {card, rollouts, nodes, value, n}. */
export function waltMove(seat, h, p, cfg = DEFAULTS, seed = 1) {
  const ctx = { ...DEFAULTS, ...cfg, rollouts: 0, nodes: 0, rootValue: 0 };
  const opts = options(h, p);
  if (opts.length === 1) return { card: opts[0], rollouts: 0, nodes: 0, value: null, n: 0 };
  const card = decide(ctx, seat, h, p, ctx.level, ctx.n, 0, makeRng(seed));
  return { card, rollouts: ctx.rollouts, nodes: ctx.nodes, value: ctx.rootValue, n: ctx.n };
}

export { P_LEN };
