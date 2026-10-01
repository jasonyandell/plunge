// Walt for Skat's play phase: the card's decide/value ladder.
//   decide(seat, private, public, level)  -- one action across all of the decider's sampled deals
//   value(me, public, deals, level)       -- exact integer count of deals the declarer makes
// Seven-function mapping (see lab/skat/REPORT.md):
//   to_move = pub.turn, outcome = outcomeDeal(pub, skatPts(deal)) (score reads the hidden
//   skat, so outcome takes the deal), private = privateOf, legal = legalList, play = play,
//   sample = sampleDeals (from the seat's own chair), maximizes = (seat === declarer).
// Lawful levers: n (live worlds), n0 (worlds per modeled mind), horizon in plies per level
// (minds inside the horizon, a cheap lawful rollout policy after it), early exits, and
// common random numbers (random choices keyed by deal index + ply, not by deal content).
import { legalList, orderedLegal, legalMask, play, sampleDeals, privateOf, outcomeDeal, ruleMove, hash32, bits, makeRng } from './skat.js';

export const DEFAULTS = { level: 1, n: 16, n0: 4, horizon: [3, 5], endgame: 0, rollout: 'rule' };

// plies searched with minds before the rollout takes over; the live rung (level === cfg.level)
// searches to the end once at most cfg.endgame plies remain.
function horizonFor(cfg, level, nPlayed) {
  if (level === cfg.level && 30 - nPlayed <= (cfg.endgame || 0)) return 30;
  const h = cfg.horizon;
  return h[Math.min(level, h.length - 1)];
}

/** the cheap rollout beyond the horizon: every seat plays from its own hand + public. */
function rollout(deal, pub, cfg, salt) {
  let p = pub;
  let k = 0;
  for (;;) {
    const o = outcomeDeal(p, deal.sp);
    if (o !== null) return o ? 1 : 0;
    const hand = deal.h[p.turn] & ~p.played;
    let c;
    if (cfg.rollout === 'rule') c = ruleMove(hand, p);
    else { const L = bits(legalMask(hand, p)); c = L[hash32(salt, deal.id, p.nPlayed + 64 * k) % L.length]; }
    p = play(p, c); k++;
  }
}

export function decide(seat, priv, pub, level, rng, cfg = DEFAULTS, n = cfg.n) {
  const opts = orderedLegal(priv.hand, pub); // tie order: deal-independent
  if (opts.length === 1) return opts[0];
  const deals = sampleDeals(seat, priv, pub, n, rng);
  const ctx = { cfg, level, rng, hz: pub.nPlayed + horizonFor(cfg, level, pub.nPlayed), salt: rng.next() };
  const maxi = seat === pub.decl;
  let best = opts[0], bestV = maxi ? -1 : deals.length + 1;
  for (const a of opts) {
    const v = value(seat, play(pub, a), deals, ctx);
    if (maxi ? v > bestV : v < bestV) {
      best = a; bestV = v;
      if (maxi ? v === deals.length : v === 0) break; // early exit: cannot be beaten
    }
  }
  return best;
}

function value(me, pub, deals, ctx) {
  // resolve deals whose outcome is already fixed (exact; outcome reads the deal's skat)
  if (pub.defPts >= 60) return 0;
  let won = 0;
  let live = deals;
  for (let i = 0; i < deals.length; i++) {
    if (pub.declPts + deals[i].sp >= 61) {
      live = deals.filter((d) => pub.declPts + d.sp < 61);
      won = deals.length - live.length;
      break;
    }
  }
  if (live.length === 0) return won;
  if (pub.nPlayed === 30) return won;
  const { cfg, level, rng } = ctx;
  if (pub.nPlayed >= ctx.hz) {
    let s = won;
    for (const d of live) s += rollout(d, pub, cfg, ctx.salt);
    return s;
  }
  const seat = pub.turn;
  if (seat === me) { // one action for every deal I can't tell apart
    const opts = legalList(live[0].h[me] & ~pub.played, pub);
    const maxi = me === pub.decl;
    let best = maxi ? -1 : live.length + 1;
    for (const a of opts) {
      const v = value(me, play(pub, a), live, ctx);
      if (maxi ? v > best : v < best) { best = v; if (maxi ? v === live.length : v === 0) break; }
    }
    return won + best;
  }
  const groups = new Map(); // what does `seat` do in each deal?
  for (const d of live) {
    const mine = privateOf(d, seat, pub);
    let a;
    if (level === 0) {
      const L = legalList(mine.hand, pub);
      a = L[hash32(ctx.salt, d.id, pub.nPlayed) % L.length]; // CRN: keyed by deal index + ply
    } else {
      a = decide(seat, mine, pub, level - 1, rng, cfg, cfg.n0);
    }
    const g = groups.get(a);
    if (g) g.push(d); else groups.set(a, [d]);
  }
  let s = won;
  for (const [a, g] of groups) s += value(me, play(pub, a), g, ctx);
  return s;
}

export function waltMove(seat, priv, pub, seed, cfg = DEFAULTS) {
  return decide(seat, priv, pub, cfg.level, makeRng(seed), cfg);
}
