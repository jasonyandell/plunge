// Baselines: random legal, a standard rule-based euchre bot, and PIMC with an
// exact perfect-information (alpha-beta) solve per sampled world.
import * as G from './engine.js';

export function makeRandom() {
  return {
    act(seat, priv, pub, seed) {
      return G.choice(G.legal(priv, pub), G.rngFrom(G.hash32(seed, 0xa11)));
    },
  };
}

// ---- rule-based bot --------------------------------------------------------
// Hand strength under trump t (integer points): trump R 12, L 10, A 8, K 7,
// Q 6, 10/9 5; off-suit A 5, off-suit K 2; each off-suit void +3 when holding
// at least two trumps.
const TRUMP_VAL = { 20: 12, 19: 10, 17: 8, 16: 7, 15: 6, 13: 5, 12: 5 };
export function strength(hand, t) {
  let s = 0, nt = 0;
  for (const c of G.cardsOf(hand)) {
    const p = G.POW[t][c];
    if (p) { s += TRUMP_VAL[p]; nt++; } else if (G.rankOf(c) === 5) s += 5;
    else if (G.rankOf(c) === 4) s += 2;
  }
  if (nt >= 2) for (let su = 0; su < 4; su++) if (su !== t && !(hand & G.SUITMASK[t][su])) s += 3;
  return s;
}
const THRESH = 25;

function bestDiscard(hand6, t) {
  let best = -1, bestS = -1;
  for (const c of G.cardsOf(hand6).sort((a, b) => G.cardKey(a, t) - G.cardKey(b, t))) {
    const s = strength(hand6 & ~(1 << c), t);
    if (s > bestS) { bestS = s; best = c; }
  }
  return best;
}

export function makeRule() {
  return {
    act(seat, priv, pub) {
      const hand = priv & G.HAND_MASK;
      const opts = G.legal(priv, pub);
      if (opts.length === 1) return opts[0];
      if (pub.phase === G.BID1) {
        const t = G.suitOf(pub.up);
        const upVal = TRUMP_VAL[G.POW[t][pub.up]];
        let s;
        if (seat === pub.dealer) {
          const h6 = hand | (1 << pub.up);
          s = strength(h6 & ~(1 << bestDiscard(h6, t)), t);
        } else if (((seat ^ pub.dealer) & 1) === 0) s = strength(hand, t) + (upVal >> 1);
        else s = strength(hand, t) - (upVal >> 1);
        return s >= THRESH ? 1 : 0;
      }
      if (pub.phase === G.DISCARD) return bestDiscard(hand, pub.trump);
      if (pub.phase === G.BID2) {
        let best = 0, bestS = THRESH - 1;
        for (let su = 0; su < 4; su++) {
          if (su === G.suitOf(pub.up)) continue;
          const s = strength(hand, su);
          if (s > bestS) { bestS = s; best = 1 + su; }
        }
        return best;
      }
      return playCard(seat, hand, pub, opts);
    },
  };
}

function playCard(seat, hand, pub, opts) {
  const t = pub.trump;
  const myTeamMakes = ((pub.maker ^ seat) & 1) === 0;
  const trumps = G.SUITMASK[t][t];
  const unseenTrump = trumps & ~pub.played & ~hand;
  const topUnseen = G.cardsOf(unseenTrump).reduce((m, c) => Math.max(m, G.POW[t][c]), 0);
  const cheap = (cs) => cs.slice().sort((a, b) => G.cardKey(a, t) - G.cardKey(b, t));
  if (pub.tl === 0) {
    const myTrumps = cheap(G.cardsOf(hand & trumps));
    const off = cheap(G.cardsOf(hand & ~trumps));
    const hiTrump = myTrumps[myTrumps.length - 1];
    if (myTeamMakes && myTrumps.length && G.POW[t][hiTrump] > topUnseen) return hiTrump;
    const aces = off.filter((c) => G.rankOf(c) === 5);
    if (aces.length) return aces[0];
    if (myTeamMakes && pub.maker !== seat && myTrumps.length) return hiTrump;
    if (off.length) {
      // lowest card of the shortest off suit
      let best = off[0], bestLen = 9;
      for (const c of off) {
        const len = G.popcount(hand & G.SUITMASK[t][G.EFF[t][c]]);
        if (len < bestLen) { bestLen = len; best = c; }
      }
      return best;
    }
    return myTrumps[0];
  }
  // following
  const led = G.EFF[t][G.trickCard(pub, 0)];
  let winI = 0, winP = -1;
  for (let i = 0; i < pub.tl; i++) {
    const pw = G.trickPower(G.trickCard(pub, i), t, led);
    if (pw > winP) { winP = pw; winI = i; }
  }
  const winner = (pub.leader + winI) & 3;
  const ordered = cheap(opts);
  if (winner === (seat ^ 2)) return ordered[0];
  const beats = ordered.filter((c) => G.trickPower(c, t, led) > winP);
  if (beats.length) return beats[0];
  return ordered[0];
}

// ---- perfect-information solver --------------------------------------------
// Exact minimax (alpha-beta) on the team-0 payoff of one fully known world.
export function makeSolver() {
  const stats = { nodes: 0 };
  function solve(pub, deal, alpha, beta) {
    stats.nodes++;
    const o = G.outcome(pub);
    if (o !== null) return o;
    const seat = pub.turn;
    const max = G.maximizes(seat);
    const [lo, hi] = G.bounds(pub);
    if (lo >= beta) return lo;
    if (hi <= alpha) return hi;
    if (alpha < lo) alpha = lo;
    if (beta > hi) beta = hi;
    const opts = G.legal(G.privateOf(deal, seat, pub), pub);
    const hidden = G.isHidden(pub);
    let v = max ? -99 : 99;
    // try strongest cards first in play
    for (let i = opts.length - 1; i >= 0; i--) {
      const a = opts[i];
      const r = hidden
        ? solve(G.play(pub, a), G.applyHidden(deal, pub, a), alpha, beta)
        : solve(G.play(pub, a), deal, alpha, beta);
      if (max) { if (r > v) v = r; if (v > alpha) alpha = v; } else { if (r < v) v = r; if (v < beta) beta = v; }
      if (alpha >= beta) break;
    }
    return v;
  }
  return { solve, stats };
}

// cfg.bid = 1: bid (order up / name trump) with the rule bot and use PIMC
// for the discard and card play ("PIMC-play"); default: PIMC everywhere,
// where each world's solve includes the remaining auction.
export function makePIMC(opts = {}) {
  const cfg = { n: 20, bid: 0, ...opts };
  const solver = makeSolver();
  const rule = makeRule();
  return {
    cfg, stats: solver.stats,
    act(seat, priv, pub, seed) {
      const options = G.legal(priv, pub);
      if (options.length === 1) return options[0];
      if (cfg.bid && (pub.phase === G.BID1 || pub.phase === G.BID2)) return rule.act(seat, priv, pub);
      const rng = G.rngFrom(G.hash32(seed, 0x91c));
      const deals = G.sample(seat, priv, pub, cfg.n, rng);
      const max = G.maximizes(seat);
      const hidden = G.isHidden(pub);
      let best = options[0], bestV = null;
      for (const a of options) {
        const next = G.play(pub, a);
        let v = 0;
        for (const d of deals) v += solver.solve(next, hidden ? G.applyHidden(d, pub, a) : d, -99, 99);
        if (bestV === null || (max ? v > bestV : v < bestV)) { bestV = v; best = a; }
      }
      return best;
    },
  };
}
