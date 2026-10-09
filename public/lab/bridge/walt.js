// Walt for bridge card play — the card's decide/value with a horizon.
// EXPLORATORY tier. See lab/WALT-CARD.md and lab/bridge/REPORT.md.
//
// Mapping onto the card's interface:
//   to_move(public)     agentOf(pub, pub.toMove()) — dummy's turn belongs to declarer
//   outcome(public)     decided(): the per-deal payoff once the record settles it (made /
//                       defeated, plus the margin tie-break terms when margin is on), else -1
//   private(deal, a)    remaining hands of the seats `a` can see (visibleSeats): declarer
//                       sees declarer+dummy; a defender sees its hand (+dummy after the lead)
//   legal               legalReduced (touching-equivalent cards collapsed)
//   play                pub.apply / pub.undo
//   sample              sampleDeals — uniform over deals consistent with the agent's view,
//                       hand sizes and revealed voids
//   maximizes(a)        declarer side maximizes made-count, defenders minimize
//
// Horizon: minds (the decider's own choices, modeled seats' nested decisions) for the
// plies [root, root+horizon); after that every seat plays the cheap deterministic rule
// bot (or random, rollout=1) to the end. All values are exact integer counts of deals.

import {
  Pub, Rng, Sim, legalCards, legalReduced, canon, ruleCard, sampleDeals, visibleSeats,
} from './engine.js';
import { tapeDecide } from './tape.js';

export const DEFAULTS = Object.freeze({ level: 1, n: 32, n0: 8, horizon: 8, rollout: 0, margin: true, seed: 1, tape: false });

// Per-deal payoff. Binary (margin off): 1 if the contract makes. With margin on, the
// payoff is MBIG*[made] + [made with an overtrick] + [not down two]: the make count stays
// the primary objective exactly (the margin terms sum to < MBIG over any sample of
// < MBIG/2 deals) and only breaks ties among moves that make equally often.
export const MBIG = 1024;
function payoff(ctx, decl) {
  const t = ctx.pub.target;
  if (!ctx.margin) return decl >= t ? 1 : 0;
  return (decl >= t ? MBIG : 0) + (decl > t ? 1 : 0) + (decl >= t - 1 ? 1 : 0);
}
/** Payoff if the public record already decides it, else -1. */
function decided(ctx) {
  const pub = ctx.pub, d = pub.declTricks;
  if (d >= ctx.hi || pub.defTricks > 13 - ctx.lo || d + pub.defTricks === 13) return payoff(ctx, d);
  return -1;
}

export const agentOf = (pub, seat) => (seat === pub.dummy ? pub.decl : seat);

function handOf(d, seat, pub) {
  const h = new Uint16Array(4);
  for (let u = 0; u < 4; u++) h[u] = d[seat * 4 + u] & ~pub.played[u];
  return h;
}

/** Live decision. `known` = Uint16Array(16) holding at least the hands `agent`
 *  can see (only those are read). Returns {card, forced, values, stats}. */
export function waltDecide(pub, agent, known, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };
  if (c.tape) return tapeDecide(pub, agent, known, c); // tape.js: record-keyed dice, full-depth minds
  if (agentOf(pub, pub.toMove()) !== agent) throw new Error('not this agent\'s turn');
  const ctx = {
    pub, hEnd: pub.n + Math.max(1, c.horizon), mode: c.rollout, n0: c.n0, margin: c.margin,
    hi: pub.target + (c.margin ? 1 : 0), lo: pub.target - (c.margin ? 1 : 0),
    top: c.margin ? MBIG + 2 : 1,
    rng: new Rng(c.seed), sim: new Sim(), stats: { minds: 0, rollouts: 0 },
  };
  if (c.n * 2 >= MBIG || c.n0 * 2 >= MBIG) throw new Error('n too large for the margin tie-break');
  const values = [];
  const card = decideIn(ctx, agent, known, c.level, c.n, values);
  // values: [card, made-count, deals] (made-count = primary objective)
  const top = ctx.margin ? MBIG : 1;
  return { card, forced: values.length === 0, values: values.map(([a, v, n]) => [a, Math.floor(v / top), n]), stats: ctx.stats };
}

function decideIn(ctx, agent, known, level, n, values) {
  const pub = ctx.pub, seat = pub.toMove();
  const h = handOf(known, seat, pub);
  const opts = legalReduced(h, pub);
  if (opts.length === 1) return opts[0];
  ctx.stats.minds++;
  // The rule bot's card is tried first: it wins ties and is the first early-exit candidate.
  const ph = agent === pub.decl ? handOf(known, (seat + 2) & 3, pub) : null;
  const rc = canon(ruleCard(pub, seat, h, ph), h, pub);
  const k = opts.indexOf(rc);
  if (k > 0) { opts.splice(k, 1); opts.unshift(rc); }
  const deals = sampleDeals(pub, visibleSeats(agent, pub), known, n, ctx.rng);
  const maxi = pub.isDeclSide(seat);
  const saved = ctx.rng, seed = saved.next();
  const full = deals.length * ctx.top;
  let best = opts[0], bestV = maxi ? -1 : full + 1;
  for (const a of opts) {
    ctx.rng = new Rng(seed); // common random numbers across candidate moves
    pub.apply(a);
    const v = value(ctx, agent, deals, level);
    pub.undo();
    if (values) values.push([a, v, deals.length]);
    if (maxi ? v > bestV : v < bestV) { bestV = v; best = a; }
    if (maxi ? bestV === full : bestV === 0) break; // early exit: saturated
  }
  ctx.rng = saved;
  return best;
}

function value(ctx, me, deals, level) {
  const pub = ctx.pub;
  const o = decided(ctx);
  if (o >= 0) return o * deals.length;
  if (pub.n >= ctx.hEnd) {
    const sim = ctx.sim;
    let s = 0;
    for (const d of deals) { sim.load(pub, d); s += payoff(ctx, sim.run(ctx.mode, ctx.rng, ctx.hi, ctx.lo)); }
    ctx.stats.rollouts += deals.length;
    return s;
  }
  const seat = pub.toMove(), agent = agentOf(pub, seat);
  if (agent === me) {
    // One action for every deal I cannot tell apart. Declarer always sees the same two
    // hands across its sample; a defender deciding the opening lead sees a different dummy
    // in each of its worlds afterwards, so its later choices are grouped by dummy.
    const maxi = pub.isDeclSide(seat);
    let total = 0;
    for (const g of groupByView(me, deals, pub)) {
      const opts = legalReduced(handOf(g[0], seat, pub), pub);
      const full = g.length * ctx.top;
      let best = maxi ? -1 : full + 1;
      for (const a of opts) {
        pub.apply(a);
        const v = value(ctx, me, g, level);
        pub.undo();
        if (maxi ? v > best : v < best) best = v;
        if (maxi ? best === full : best === 0) break;
      }
      total += best;
    }
    return total;
  }
  // Another seat: what does it do in each deal? It decides from its own chair.
  const acts = new Map();
  for (const d of deals) {
    const h = handOf(d, seat, pub);
    let a;
    if (level === 0) {
      const all = legalCards(h, pub);
      a = canon(all[ctx.rng.int(all.length)], h, pub);
    } else {
      a = decideIn(ctx, agent, d, level - 1, ctx.n0, null);
    }
    const g = acts.get(a);
    if (g) g.push(d); else acts.set(a, [d]);
  }
  let sum = 0;
  for (const [a, g] of acts) {
    pub.apply(a);
    sum += value(ctx, me, g, level);
    pub.undo();
  }
  return sum;
}

function groupByView(me, deals, pub) {
  if (me === pub.decl || !pub.dummyVisible() || deals.length === 1) return [deals];
  const dm = pub.dummy * 4, p = pub.played;
  const key = (d) => (d[dm] & ~p[0]) + (d[dm + 1] & ~p[1]) * 8192 + (d[dm + 2] & ~p[2]) * 67108864 + (d[dm + 3] & ~p[3]) * 549755813888;
  const k0 = key(deals[0]);
  let same = true;
  for (let i = 1; i < deals.length && same; i++) same = key(deals[i]) === k0;
  if (same) return [deals];
  const m = new Map();
  for (const d of deals) { const k = key(d); const g = m.get(k); if (g) g.push(d); else m.set(k, [d]); }
  return [...m.values()];
}

/** Replay helper: a Pub from a contract and a list of played cards. */
export function pubFrom(ct, plays) {
  const p = new Pub(ct.decl, ct.strain, ct.level);
  for (const c of plays) p.apply(c);
  return p;
}

