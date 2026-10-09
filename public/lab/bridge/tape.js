// Walt for bridge with the tickertape (texas-42 Def 3.5/3.6): the random bottom
// is keyed on (world, record), not on the search path. EXPLORATORY tier.
//
// Three consequences, each lawful under the card's information rule:
//   1. Dice purity: the same world at the same record plays the same card in
//      every branch, so worlds partition by drawn move instead of multiplying
//      branches, and common random numbers across candidate cards are automatic.
//   2. Mind purity: a modeled seat's decision is a pure function of (its own
//      remaining hand, the public record, deal-independent noise), so it is
//      cached under exactly that key. Same information state, same action.
//   3. Count alpha-beta: values are exact integer counts in [0, deals*top], so
//      fail-soft windows prune both my own max/min nodes and partition sums
//      without changing the chosen card (ties still go to the first candidate).
//
// Beyond the minds horizon every seat plays taped dice to the end of the hand
// (random rollouts, no rule bot in the evaluation path). The rule bot may still
// order candidates at decision roots (cfg.ruleOrder) — ordering only, never value.
//
// The information rule: every draw here reads only the decider's own holding,
// the public record, and noise derived from frozen seeds mixed with those same
// structural coordinates (never another seat's hidden cards).

import {
  Rng, mix, SUIT, RANK, legalCards, legalReduced, canon, ruleCard,
  sampleDeals, visibleSeats, trickWinnerPos,
} from './engine.js';
import { featurize, makeScorer } from './features.js';
import SCORER_WEIGHTS from './scorer-weights.js';

const SCORER = SCORER_WEIGHTS ? makeScorer(SCORER_WEIGHTS) : null;

export const MBIG = 1024;

// ---------------------------------------------------------------- frozen noise
// Zobrist material, generated from frozen constants only (42's Def 3.6: no
// wall-clock, no global RNG state).
const TAPE_SEED = 0x5eed7a9e, MIND_SEED = 0x3c6ef372, ROOT_SEED = 0x9e3779b9, PICK_SEED = 0x7f4a7c15;
const ZA = new Int32Array(52), ZB = new Int32Array(52);
{
  const g = new Rng(TAPE_SEED);
  for (let c = 0; c < 52; c++) { ZA[c] = g.next() | 0; ZB[c] = g.next() | 0; }
}

/** Record key: played set (zobrist), leader, trick counts and the current
 *  trick's cards in order. Pure function of the record-as-state, so two
 *  histories reaching the same state share every draw (transpositions agree). */
function recordKeyA(pub, zp) {
  let k = mix(zp, pub.leader | (pub.declTricks << 2) | (pub.defTricks << 7) | (pub.tl << 12));
  for (let i = 0; i < pub.tl; i++) k = mix(k, pub.tc[i] + 1);
  return k;
}
function recordKeyB(pub, zp) {
  let k = mix(zp ^ 0x85ebca6b, (pub.tl << 9) | (pub.defTricks << 5) | (pub.declTricks << 1) | pub.leader);
  for (let i = 0; i < pub.tl; i++) k = mix(k, (pub.tc[i] + 1) << 6);
  return k;
}

function worldHash(d) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < 16; i++) { a = mix(a, d[i] + 1); b = mix(b ^ 0x27d4eb2f, d[i] + 1); }
  d.whA = a; d.whB = b;
  return d;
}

// ---------------------------------------------------------------- legal picks
// Count and pick legal cards without allocating (dice draws are the hot path).
function legalCount(h, pub) {
  let lo = 0, hi = 3;
  if (pub.tl > 0) { const L = SUIT[pub.tc[0]]; if (h[L]) { lo = hi = L; } }
  let n = 0;
  for (let u = lo; u <= hi; u++) { let m = h[u]; while (m) { m &= m - 1; n++; } }
  return n;
}
function legalPick(h, pub, k) {
  let lo = 0, hi = 3;
  if (pub.tl > 0) { const L = SUIT[pub.tc[0]]; if (h[L]) { lo = hi = L; } }
  for (let u = lo; u <= hi; u++) {
    let m = h[u];
    while (m) { const r = 31 - Math.clz32(m & -m); if (k-- === 0) return u * 13 + r; m &= m - 1; }
  }
  throw new Error('legalPick out of range');
}

/** Bounded choice: keep a uniform k-subset of `opts`, keyed on (the decider's
 *  own remaining hand, the record, a frozen seed) — the same structural-noise
 *  discipline as the dice, so it reads nothing hidden and the same information
 *  set in the same line always sees the same subset. Uniform: no rank order,
 *  no rule-bot presupposition decides inclusion. Coverage of the cards left
 *  out comes from revisits: other worlds give minds other hands, and other
 *  records (other root candidates, other earlier plays) redraw the subset. */
function boundOpts(ctx, opts, k, h) {
  if (!k || opts.length <= k) return opts;
  let s = mix(recordKeyA(ctx.pub, ctx.zp), PICK_SEED);
  s = mix(mix(mix(s, h[0] + 1), mix(h[1] + 1, h[2] + 1)), h[3] + 1);
  let t = mix(recordKeyB(ctx.pub, ctx.zq), s);
  for (let i = 0; i < k; i++) {
    t = mix(t, i + 1);
    const j = i + ((t >>> 0) % (opts.length - i));
    const tmp = opts[i]; opts[i] = opts[j]; opts[j] = tmp;
  }
  opts.length = k;
  return opts;
}

const SCRATCH_H = new Uint16Array(4);
function handInto4(out, d, seat, pub) {
  const b = seat * 4;
  out[0] = d[b] & ~pub.played[0]; out[1] = d[b + 1] & ~pub.played[1];
  out[2] = d[b + 2] & ~pub.played[2]; out[3] = d[b + 3] & ~pub.played[3];
  return out;
}
function handOf(d, seat, pub) { return handInto4(new Uint16Array(4), d, seat, pub); }

export const agentOf = (pub, seat) => (seat === pub.dummy ? pub.decl : seat);

// ---------------------------------------------------------------- payoff
function payoff(ctx, decl) {
  const t = ctx.pub.target;
  if (!ctx.margin) return decl >= t ? 1 : 0;
  return (decl >= t ? MBIG : 0) + (decl > t ? 1 : 0) + (decl >= t - 1 ? 1 : 0);
}
function decided(ctx) {
  const pub = ctx.pub, d = pub.declTricks;
  if (d >= ctx.hi || pub.defTricks > 13 - ctx.lo || d + pub.defTricks === 13) return payoff(ctx, d);
  return -1;
}

// ---------------------------------------------------------------- taped rollout
// Every seat plays taped dice from here to a decided record. The draw at each
// step is keyed exactly like the in-tree dice, so a (world, record) pair plays
// the same continuation whether it is reached inside the tree or in a rollout.
const RO = {
  played: new Uint16Array(4), tc: new Uint8Array(4), hands: new Uint16Array(16), h: new Uint16Array(4),
};
function tapeRollout(ctx, d, salt = 0) {
  const pub = ctx.pub, strain = pub.strain;
  const hands = RO.hands, h = RO.h, played = RO.played, tc = RO.tc;
  for (let u = 0; u < 4; u++) played[u] = pub.played[u];
  for (let i = 0; i < 16; i++) hands[i] = d[i] & ~pub.played[i & 3];
  let leader = pub.leader, tl = pub.tl, declT = pub.declTricks, defT = pub.defTricks;
  for (let i = 0; i < tl; i++) tc[i] = pub.tc[i];
  let zp = ctx.zp;
  const defMax = 13 - ctx.lo;
  for (;;) {
    if (declT >= ctx.hi || defT > defMax || declT + defT === 13) { ctx.stats.rollouts++; return payoff(ctx, declT); }
    const seat = (leader + tl) & 3;
    h[0] = hands[seat * 4]; h[1] = hands[seat * 4 + 1]; h[2] = hands[seat * 4 + 2]; h[3] = hands[seat * 4 + 3];
    // inline legal count/pick against the local trick
    let lo = 0, hi3 = 3;
    if (tl > 0) { const L = SUIT[tc[0]]; if (h[L]) { lo = hi3 = L; } }
    let n = 0;
    for (let u = lo; u <= hi3; u++) { let m = h[u]; while (m) { m &= m - 1; n++; } }
    let c;
    if (n === 1) {
      for (let u = lo; u <= hi3; u++) if (h[u]) { c = u * 13 + (31 - Math.clz32(h[u] & -h[u])); break; }
    } else {
      let kA = mix(zp ^ salt, leader | (declT << 2) | (defT << 7) | (tl << 12));
      for (let i = 0; i < tl; i++) kA = mix(kA, tc[i] + 1);
      let k = (mix(d.whA, kA) >>> 0) % n;
      for (let u = lo; u <= hi3; u++) {
        let m = h[u];
        while (m) { const r = 31 - Math.clz32(m & -m); if (k-- === 0) { c = u * 13 + r; u = 4; break; } m &= m - 1; }
      }
    }
    const s = SUIT[c], bit = 1 << RANK[c];
    hands[seat * 4 + s] &= ~bit; played[s] |= bit; zp = (zp ^ ZA[c]) | 0;
    tc[tl++] = c;
    if (tl === 4) {
      const w = (leader + trickWinnerPos(tc, 4, strain)) & 3;
      if (w === pub.decl || w === pub.dummy) declT++; else defT++;
      leader = w; tl = 0;
    }
  }
}

// ---------------------------------------------------------------- the search
// apply/undo that also maintains the played-set zobrist on ctx.
function apply(ctx, c) { ctx.pub.apply(c); ctx.zp = (ctx.zp ^ ZA[c]) | 0; ctx.zq = (ctx.zq ^ ZB[c]) | 0; }
function undo(ctx, c) { ctx.pub.undo(); ctx.zp = (ctx.zp ^ ZA[c]) | 0; ctx.zq = (ctx.zq ^ ZB[c]) | 0; }

/** Live decision, taped. Same contract as walt.js's waltDecide.
 *
 *  cfg.vector: evaluate every root candidate exactly (no root cutoffs), so the
 *  returned values are an honest pmake vector, not fail-soft bounds. The chosen
 *  card is unchanged (pruning never changed the argmax; this just refuses to
 *  stop early or return bounds for the also-rans).
 *  cfg.refine {n?, n0?, draws?, l0Tail?, eps?, m?}: a second, finer pass over
 *  the finalists — every candidate whose blunt make-rate is within eps (default
 *  0.1) of the blunt best, capped at m (default 4) — on a FRESH root sample
 *  with the overridden settings. The blunt pass is the vaguely-correct
 *  estimate; the refine pass spends the budget only where the answer is close.
 *  cfg.field: a Map passed in by the caller to persist the mind cache across
 *  decisions (an overlapping computation field: the next real position was
 *  usually already explored as a subtree of the last search; purity makes the
 *  reuse sound). Only lawful at full depth with kFrom 0 — guarded below.
 */
export function tapeDecide(pub, agent, known, c) {
  if (agentOf(pub, pub.toMove()) !== agent) throw new Error("not this agent's turn");
  if (c.n * 2 >= MBIG || c.n0 * 2 >= MBIG) throw new Error('n too large for the margin tie-break');
  if (c.l0 === 'scorer' && !SCORER) throw new Error('l0 scorer: no trained weights (run lab/bridge/scorer/train.mjs)');
  const ctx = makeCtx(pub, agent, c);
  const values = [];
  const rootRng = new Rng(mix(c.seed, ROOT_SEED));
  let card = decideIn(ctx, agent, known, c.level, c.n, rootRng, values);
  const top = ctx.margin ? MBIG : 1;
  let out = values.map(([a, v, nn]) => [a, Math.floor(Math.max(0, v) / top), nn]);
  const stats = ctx.stats;
  if (c.refine && values.length > 1) {
    const maxi = pub.isDeclSide(pub.toMove());
    // Finalists: within eps of the blunt best by make-rate, capped at m, the
    // blunt winner always included. With a pruned (non-vector) blunt pass the
    // also-rans carry fail-soft bounds, which under-rate them on the declarer
    // side — near-ties can be missed; vector:true in the base config removes
    // that at extra cost. Harmless over-inclusion on defence.
    const eps = c.refine.eps ?? 0.1, m = c.refine.m ?? 4;
    const rate = (e) => e[1] / e[2];
    const bestE = out.find((e) => e[0] === card);
    let fins = out
      .filter((e) => e[0] === card || (maxi ? rate(bestE) - rate(e) : rate(e) - rate(bestE)) <= eps)
      .sort((x, y) => (x[0] === card ? -1 : y[0] === card ? 1 : maxi ? rate(y) - rate(x) : rate(x) - rate(y)))
      .slice(0, m)
      .map((e) => e[0]);
    if (fins.length > 1) {
      const c2 = { ...c, ...c.refine, refine: null, fieldMap: c.refine.fieldMap, seed: mix(c.seed, 0x5ef17e3) };
      const ctx2 = makeCtx(pub, agent, c2);
      const rng2 = new Rng(mix(c2.seed, ROOT_SEED));
      const deals2 = sampleDeals(pub, visibleSeats(agent, pub), known, c2.n, rng2);
      for (const d of deals2) worldHash(d);
      const vals2 = [];
      card = evalCands(ctx2, agent, c2.level, fins, deals2, vals2, true);
      const top2 = ctx2.margin ? MBIG : 1;
      const refined = new Map(vals2.map(([a, v, nn]) => [a, [a, Math.floor(Math.max(0, v) / top2), nn]]));
      out = out.map((e) => refined.get(e[0]) ?? e);
      for (const k2 of Object.keys(ctx2.stats)) stats[k2] += ctx2.stats[k2];
      stats.refined = fins.length;
    }
  }
  return { card, forced: values.length === 0, values: out, stats };
}

function makeCtx(pub, agent, c) {
  const ctx = {
    pub, hEnd: pub.n + Math.max(1, c.horizon), n0: c.n0, margin: c.margin,
    hi: pub.target + (c.margin ? 1 : 0), lo: pub.target - (c.margin ? 1 : 0),
    top: c.margin ? MBIG + 2 : 1,
    level0n: c.n0, ruleOrder: c.ruleOrder !== false, prune: c.prune !== false,
    // Bounded choice (0 = all cards): k at modeled minds' interior own turns,
    // kMe at the live player's own interior turns, kRoot at mind roots.
    // kFrom: plies from the root before which everyone searches full-width
    // (the near-root tactics region; bounded choice applies only beyond it).
    k: c.k || 0, kMe: c.kMe ?? (c.k || 0), kRoot: c.kRoot ?? (c.k || 0),
    kEnd: pub.n + (c.kFrom || 0),
    // selfs 'mind': below the root, the live player's own turns are played by
    // the same level-0 mind machinery as every other seat (level 1 = best
    // response AT THE ROOT to a world where everyone, including future-me, is
    // a level-0 mind). The value tree then only partitions - it never branches.
    // l0 'flat': a level-0 mind is the myopic best response to random - argmax
    // over its cards of the make-fraction under all-dice taped rollouts across
    // its n0 sampled worlds - instead of the recursive k-bounded search.
    // l0Tail: within the last T plies a 'flat' level-0 mind switches to the
    // recursive search (endgames want precision and their trees are tiny).
    // l0 'scorer': a level-0 mind is the trained lawful-feature scorer —
    // belief-free (no sampled worlds, no rollouts): argmax over its candidates
    // of the net's P(make) logit from (its visible hands, public record).
    // The 42 finding this tests: a net that is mediocre as a player can still
    // be the right cheap inner mind for the search to model others with.
    selfs: c.selfs || 'branch', l0: c.l0 || 'search', l0Tail: c.l0Tail || 0,
    draws: c.draws || 1,
    minds: new Map(), zp: 0, zq: 0,
    tt: c.tt === true ? new Map() : null, // exact-value transpositions: sound under the tape, but
    // measured a net loss at k=2 (few identical (group, record) recurrences; hashing every node
    // costs more than the rare hit saves), so opt-in only
    stats: { minds: 0, rollouts: 0, mindHits: 0, nodes: 0, ttHits: 0, flat: 0, scored: 0, refined: 0 },
    vector: c.vector === true,
  };
  ctx.rootAgent = agent;
  // Persistent mind field across decisions (same Map handed back each move).
  // Sound only when the mind function is ply-invariant: full depth (hEnd never
  // binds) and no kFrom window. Purity does the rest: same key, same action,
  // whenever it was computed.
  if (c.fieldMap instanceof Map && c.horizon >= 52 && !(c.kFrom > 0)) ctx.minds = c.fieldMap;
  // Rebuild the played-set zobrist for the record so far.
  for (let i = 0; i < pub.n; i++) { ctx.zp = (ctx.zp ^ ZA[pub.plays[i]]) | 0; ctx.zq = (ctx.zq ^ ZB[pub.plays[i]]) | 0; }
  return ctx;
}

/** One decision: sample deals from this chair, pick the argmax/argmin card.
 *  `rng` is the sampler's noise: the live root's stream, or a mind's structural
 *  stream. Fail-soft windows keep the argmax and first-wins-ties exact. */
function decideIn(ctx, agent, known, level, n, rng, values) {
  const pub = ctx.pub, seat = pub.toMove();
  const h = handOf(known, seat, pub);
  let opts = legalReduced(h, pub);
  if (opts.length === 1) return opts[0];
  ctx.stats.minds++;
  // Mind roots are bounded (values === null) outside the near-root full-width
  // region; the live root considers every card.
  if (values === null && pub.n >= ctx.kEnd) opts = boundOpts(ctx, opts, ctx.kRoot, h);
  if (opts.length === 1) return opts[0];
  if (ctx.ruleOrder) {
    const ph = agent === pub.decl ? handOf(known, (seat + 2) & 3, pub) : null;
    const rc = canon(ruleCard(pub, seat, h, ph), h, pub);
    const k = opts.indexOf(rc);
    if (k > 0) { opts.splice(k, 1); opts.unshift(rc); }
  }
  const deals = sampleDeals(pub, visibleSeats(agent, pub), known, n, rng);
  for (const d of deals) worldHash(d);
  // vector mode applies at the live root only (values !== null)
  return evalCands(ctx, agent, level, opts, deals, values, values !== null && ctx.vector);
}

/** Evaluate candidate cards over a fixed set of sampled deals. In vector mode
 *  every candidate gets an exact value (no cutoffs, no early exit); otherwise
 *  fail-soft windows keep only the argmax and first-wins-ties exact. */
function evalCands(ctx, agent, level, opts, deals, values, vector) {
  const pub = ctx.pub, maxi = pub.isDeclSide(pub.toMove());
  const full = deals.length * ctx.top;
  let best = opts[0], bestV = maxi ? -1 : full + 1;
  for (const a of opts) {
    apply(ctx, a);
    // window: only values strictly better than bestV matter
    const v = (vector || !ctx.prune) ? value(ctx, agent, deals, level, -1, full + 1)
      : maxi ? value(ctx, agent, deals, level, bestV, full + 1)
             : value(ctx, agent, deals, level, -1, bestV);
    undo(ctx, a);
    if (values) values.push([a, v, deals.length]);
    if (maxi ? v > bestV : v < bestV) { bestV = v; best = a; }
    if (!vector && (maxi ? bestV >= full : bestV <= 0)) break;
  }
  return best;
}

/** Fail-soft value of `deals` for agent `me` within the window (lo, hi):
 *  exact when lo < v < hi; a valid bound (<= lo or >= hi) otherwise. */
function value(ctx, me, deals, level, lo, hi) {
  const pub = ctx.pub;
  ctx.stats.nodes++;
  if (!ctx.prune) { lo = -1; hi = deals.length * ctx.top + 1; } // verification mode: exact everywhere
  const o = decided(ctx);
  if (o >= 0) return o * deals.length;
  if (pub.n >= ctx.hEnd) {
    let s = 0;
    for (let i = 0; i < deals.length; i++) s += tapeRollout(ctx, deals[i]);
    return s;
  }
  // Transposition table: under the tape, (who is thinking, level, the group of
  // worlds as a multiset, the record-as-state) determines the value exactly, so
  // exact results (fail-soft value strictly inside the window) are reusable.
  let mk = 0;
  if (ctx.tt) {
    let sA = deals.length, sB = 0x9e3779b9;
    for (let i = 0; i < deals.length; i++) { sA = (sA + deals[i].whA) | 0; sB = (sB + deals[i].whB) | 0; }
    const kA = mix(mix(recordKeyA(pub, ctx.zp), sA), (me << 3) | level);
    const kB = mix(mix(recordKeyB(pub, ctx.zq), sB), (level << 5) | me);
    mk = (kA >>> 11) * 0x100000000 + (kB >>> 0) + 1;
    const hit = ctx.tt.get(mk);
    if (hit !== undefined) { ctx.stats.ttHits++; return hit; }
  }
  const v = valueIn(ctx, me, deals, level, lo, hi);
  if (mk && lo < v && v < hi && ctx.tt.size < 4e6) ctx.tt.set(mk, v);
  return v;
}

function valueIn(ctx, me, deals, level, lo, hi) {
  const pub = ctx.pub;
  const seat = pub.toMove(), agent = agentOf(pub, seat);
  if (agent === me) {
    const groups = groupByView(me, deals, pub);
    // selfs 'mind' applies at level >= 1: a level-k decider's own future turns
    // are level-(k-1) minds. Inside a recursive level-0 mind (level === 0) the
    // card's own-move branching is kept: level 0 IS best response to random.
    const node = ctx.selfs === 'mind' && level >= 1 ? selfNode : myNode;
    if (groups.length === 1) return node(ctx, me, groups[0], level, lo, hi);
    // several views (opening leader with different dummies): a windowed sum
    let acc = 0, restPot = 0;
    for (const g of groups) restPot += g.length * ctx.top;
    for (const g of groups) {
      restPot -= g.length * ctx.top;
      const cv = node(ctx, me, g, level, lo - acc - restPot, hi - acc);
      acc += cv;
      if (acc >= hi) return acc;
      if (acc + restPot <= lo) return acc + restPot;
    }
    return acc;
  }
  // A modeled seat: group the deals by what that seat does — taped dice at
  // level 0, a cached pure mind at level >= 1.
  const acts = new Map();
  const kA = level === 0 ? recordKeyA(pub, ctx.zp) : 0;
  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    const h = handInto4(SCRATCH_H, d, seat, pub);
    let a;
    if (level === 0) {
      const nleg = legalCount(h, pub);
      a = nleg === 1 ? legalPick(h, pub, 0)
        : canon(legalPick(h, pub, (mix(d.whA, kA) >>> 0) % nleg), h, pub);
    } else {
      a = mindMove(ctx, agent, seat, d, h, level);
    }
    const g = acts.get(a);
    if (g) g.push(d); else acts.set(a, [d]);
  }
  if (acts.size === 1) {
    const [a, g] = acts.entries().next().value;
    apply(ctx, a);
    const v = value(ctx, me, g, level, lo, hi);
    undo(ctx, a);
    return v;
  }
  let acc = 0, restPot = deals.length * ctx.top;
  for (const [a, g] of acts) {
    restPot -= g.length * ctx.top;
    apply(ctx, a);
    const cv = value(ctx, me, g, level, lo - acc - restPot, hi - acc);
    undo(ctx, a);
    acc += cv;
    if (acc >= hi) return acc;
    if (acc + restPot <= lo) return acc + restPot;
  }
  return acc;
}

/** My own turn over one indistinguishable group: fail-soft max/min. */
function myNode(ctx, me, g, level, lo, hi) {
  const pub = ctx.pub, seat = pub.toMove();
  const hh = handInto4(SCRATCH_H, g[0], seat, pub);
  const kw = pub.n < ctx.kEnd ? 0 : (me === ctx.rootAgent ? ctx.kMe : ctx.k);
  const opts = boundOpts(ctx, legalReduced(hh, pub), kw, hh);
  const maxi = pub.isDeclSide(seat);
  if (opts.length === 1) {
    apply(ctx, opts[0]);
    const v = value(ctx, me, g, level, lo, hi);
    undo(ctx, opts[0]);
    return v;
  }
  if (maxi) {
    let v = -1;
    for (const a of opts) {
      apply(ctx, a);
      const cv = value(ctx, me, g, level, ctx.prune && v > lo ? v : lo, hi);
      undo(ctx, a);
      if (cv > v) v = cv;
      if (ctx.prune && v >= hi) return v;
    }
    return v < 0 ? 0 : v;
  }
  let v = g.length * ctx.top + 1;
  const cap = g.length * ctx.top;
  for (const a of opts) {
    apply(ctx, a);
    const cv = value(ctx, me, g, level, lo, ctx.prune && v < hi ? v : hi);
    undo(ctx, a);
    if (cv < v) v = cv;
    if (ctx.prune && v <= lo) return v;
  }
  return v > cap ? cap : v;
}

/** selfs 'mind': the live player's own turn below the root is played by the
 *  same cached level-0 mind machinery as any other seat, keyed on my visible
 *  hands and the record — the identical information state gives the identical
 *  action whether the seat is modeled by an opponent or by its own root search.
 *  One action per information set holds trivially: the mind reads only what
 *  the group shares. */
function selfNode(ctx, me, g, level, lo, hi) {
  const pub = ctx.pub, seat = pub.toMove();
  const h = handInto4(SCRATCH_H, g[0], seat, pub);
  const a = legalCount(h, pub) === 1 ? legalPick(h, pub, 0)
    : mindMove(ctx, agentOf(pub, seat), seat, g[0], h, level);
  apply(ctx, a);
  const v = value(ctx, me, g, level, lo, hi);
  undo(ctx, a);
  return v;
}

/** l0 'flat': the myopic form of "best response to random". For each of the
 *  mind's candidate cards, every one of its n0 sampled worlds is played to the
 *  end with taped dice at every seat; the card with the best make-count for
 *  its side wins (exact integers; ties to the first candidate). */
function decideM1(ctx, agent, known, n, rng) {
  const pub = ctx.pub, seat = pub.toMove();
  const h = handOf(known, seat, pub);
  const opts = legalReduced(h, pub);
  if (opts.length === 1) return opts[0];
  ctx.stats.flat++;
  if (ctx.ruleOrder) {
    const ph = agent === pub.decl ? handOf(known, (seat + 2) & 3, pub) : null;
    const rc = canon(ruleCard(pub, seat, h, ph), h, pub);
    const kk = opts.indexOf(rc);
    if (kk > 0) { opts.splice(kk, 1); opts.unshift(rc); }
  }
  const deals = sampleDeals(pub, visibleSeats(agent, pub), known, n, rng);
  for (const d of deals) worldHash(d);
  // draws: rollouts per world per candidate (dice keyed on (world, record,
  // draw index)); more draws reduce playout noise only, as the card says.
  const R = ctx.draws, maxi = pub.isDeclSide(seat), full = deals.length * R * ctx.top;
  let best = opts[0], bestV = maxi ? -1 : full + 1;
  for (const a of opts) {
    apply(ctx, a);
    let v = 0;
    const o = decided(ctx);
    if (o >= 0) v = o * deals.length * R;
    else for (let i = 0; i < deals.length; i++) for (let r = 0; r < R; r++) v += tapeRollout(ctx, deals[i], Math.imul(r, 0x9e3779b9));
    undo(ctx, a);
    if (maxi ? v > bestV : v < bestV) { bestV = v; best = a; }
    if (maxi ? bestV >= full : bestV <= 0) break;
  }
  return best;
}

/** l0 'scorer': the mind picks by the trained scorer's logit — a pure
 *  function of (its visible hands, the public record); argmax for the
 *  declarer side, argmin for the defence. No worlds, no rollouts. */
function decideMS(ctx, agent, known) {
  const pub = ctx.pub, seat = pub.toMove();
  const h = handOf(known, seat, pub);
  const opts = legalReduced(h, pub);
  if (opts.length === 1) return opts[0];
  ctx.stats.scored++;
  const vis = visibleSeats(agent, pub);
  const visHands = [null, null, null, null];
  for (let s = 0; s < 4; s++) if (vis & (1 << s)) visHands[s] = handOf(known, s, pub);
  const ph = agent === pub.decl ? visHands[(seat + 2) & 3] : null;
  const ruleC = canon(ruleCard(pub, seat, h, ph), h, pub);
  const maxi = pub.isDeclSide(seat);
  let best = opts[0], bz = maxi ? -Infinity : Infinity;
  for (const a of opts) {
    const z = SCORER(featurize(pub, seat, agent, h, visHands, opts.length, a, ruleC));
    if (maxi ? z > bz : z < bz) { bz = z; best = a; }
  }
  return best;
}

/** A modeled seat's move in deal d: a pure function of (seat, every hand its
 *  agent can see, the record, revealed voids, level) — cached under exactly
 *  that key. A modeled declarer sees dummy too, and at the opening lead the
 *  sampled worlds carry different dummies, so ALL visible hands must be in the
 *  key (42's PiKey defect record: an omitted coordinate aliases the cache).
 *  Its belief sample is seeded from the same coordinates (42's Def 3.6), never
 *  from another seat's hidden cards. */
function mindMove(ctx, agent, seat, d, h, level) {
  const pub = ctx.pub;
  let kA = mix(recordKeyA(pub, ctx.zp), MIND_SEED + level);
  let kB = mix(recordKeyB(pub, ctx.zq), (seat << 8) | level);
  const vis = visibleSeats(agent, pub);
  for (let s = 0; s < 4; s++) {
    if (!(vis & (1 << s))) continue;
    const b = s * 4, p = pub.played;
    kA = mix(mix(kA, (d[b] & ~p[0]) + 1 + (s << 13)), mix((d[b + 1] & ~p[1]) + 1, (d[b + 2] & ~p[2]) + 1));
    kB = mix(kB, mix((d[b] & ~p[0]) + 3 + (s << 11), mix((d[b + 1] & ~p[1]) << 2, ((d[b + 2] & ~p[2]) << 1) ^ ((d[b + 3] & ~p[3]) + 5))));
    kA = mix(kA, (d[b + 3] & ~p[3]) + 1);
  }
  const voids = pub.voids[0] | (pub.voids[1] << 4) | (pub.voids[2] << 8) | (pub.voids[3] << 12);
  kA = mix(kA, (voids << 2) | seat);
  kB = mix(kB, voids + 0x9e37);
  const key = (kA >>> 11) * 0x100000000 + (kB >>> 0);
  const hit = ctx.minds.get(key);
  if (hit !== undefined) { ctx.stats.mindHits++; return hit; }
  const rng = new Rng((mix(kA, kB) >>> 0) || 1);
  const cheap = level === 1 && 52 - pub.n > ctx.l0Tail;
  const a = (cheap && ctx.l0 === 'scorer') ? decideMS(ctx, agent, d)
    : (cheap && ctx.l0 === 'flat') ? decideM1(ctx, agent, d, ctx.n0, rng)
    : decideIn(ctx, agent, d, level - 1, ctx.n0, rng, null);
  if (ctx.minds.size < 8e6) ctx.minds.set(key, a); // cap: degrade to recompute, never crash
  return a;
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
