// Walt for Hearts: the card's decide/value ladder, generalized to a
// 4-seat game where every seat minimizes its own hand score (integer
// points, shoot-the-moon included), summed over its sampled deals.
//
// Lawful levers used: n (my worlds), n0 (worlds per modeled mind), a
// horizon in plies (modeled minds and my own chosen moves for the next H
// plies; a cheap rollout beyond it), common random numbers across my
// candidate moves, and the early exit "this move already reaches the
// public lower bound in every world".
import {
  NPLAYED, TOMOVE, legalClasses, legalCards, randomLegal, play, isDone, payoff,
  payoffLowerBound, privateHand, sampleDeals,
} from './engine.js';
import { rollout } from './bots.js';

export const DEFAULTS = { level: 1, n: 24, n0: 4, horizon: 6, rollout: 'rule' };

// Live entry point. `hand` is the decider's current hand (4 masks), `pins`
// the cards it knows the location of (what it passed), or null.
export function waltMove(seat, hand, pub, rng, settings = DEFAULTS, pins = null) {
  const ctx = {
    n0: settings.n0,
    stop: pub[NPLAYED] + settings.horizon,
    policy: settings.rollout,
    stats: settings.stats || null,
  };
  return decide(seat, hand, pub, settings.level, rng, settings.n, ctx, pins);
}

function decide(seat, hand, pub, level, rng, n, ctx, pins) {
  const options = legalClasses(hand, 0, pub);
  if (options.length === 1) return options[0];
  const deals = sampleDeals(seat, hand, pub, n, rng, pins); // from seat's chair only
  const lb = payoffLowerBound(pub, seat) * deals.length;
  const base = rng.clone(); // common random numbers across candidates
  let best = options[0], bestV = Infinity;
  for (const a of options) {
    rng.restore(base);
    const v = value(seat, play(pub, a), deals, level, rng, ctx);
    if (v < bestV) { bestV = v; best = a; }
    if (bestV <= lb) break; // early exit: cannot do better in any world
  }
  return best;
}

function value(me, pub, deals, level, rng, ctx) {
  if (isDone(pub)) {
    let t = 0;
    for (let i = 0; i < deals.length; i++) t += payoff(pub, me);
    return t;
  }
  if (pub[NPLAYED] >= ctx.stop) {
    if (ctx.stats) ctx.stats.rollouts += deals.length;
    let t = 0;
    for (const d of deals) t += rollout(d, pub, me, ctx.policy, rng);
    return t;
  }
  const seat = pub[TOMOVE];
  if (seat === me) {
    // one action for every deal I can't tell apart
    const options = legalClasses(privateHand(deals[0], me, pub), 0, pub);
    if (options.length === 1) return value(me, play(pub, options[0]), deals, level, rng, ctx);
    const lb = payoffLowerBound(pub, me) * deals.length;
    let best = Infinity;
    for (const a of options) {
      const v = value(me, play(pub, a), deals, level, rng, ctx);
      if (v < best) best = v;
      if (best <= lb) break;
    }
    return best;
  }
  // what does `seat` do in each deal?
  const groups = new Map();
  for (const d of deals) {
    const mine = privateHand(d, seat, pub);
    const a =
      level === 0
        ? randomLegal(mine, 0, pub, rng)
        : decide(seat, mine, pub, level - 1, rng, ctx.n0, ctx, null);
    let g = groups.get(a);
    if (!g) groups.set(a, (g = []));
    g.push(d);
  }
  let t = 0;
  for (const [a, g] of groups) t += value(me, play(pub, a), g, level, rng, ctx);
  return t;
}

export { legalCards };
