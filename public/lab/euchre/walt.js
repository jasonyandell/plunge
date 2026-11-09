// Walt (texas-42 issue #99 algorithm card) over the euchre interface.
//
// decide/value follow the card line for line, generalised in three lawful ways:
//  * outcome is an integer team-0 payoff (points this hand), summed over deals;
//  * the dealer's discard is a HIDDEN action: the public successor is the same
//    for every discard, and the deals themselves are rewritten (applyHidden);
//    the deciding/modeled dealer still picks ONE discard per information set;
//  * modeled seats' noise is seeded from (root nonce, seat, its holding, public
//    record) only -- deal-independent noise, so a modeled seat plays one action
//    per information set, never per world.
import * as G from './engine.js';

// level: ladder height of the live player in card play; bidLevel/bidN: the
// same for the auction and the discard (default: as for play).
export const DEFAULTS = { level: 1, n: 24, n0: 8, n1: 8 };

export function makeWalt(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const stats = { nodes: 0, decides: 0 };

  // samples per decide at a given level: root uses cfg.n; modeled seats at
  // level 0 use n0, at level 1 (inside an L2 root) use n1.
  const nAt = (level) => (level === 0 ? cfg.n0 : cfg.n1);

  const INF = 1 << 30;

  function decide(seat, priv, pub, level, rng, n) {
    stats.decides++;
    const options = G.legal(priv, pub);
    if (options.length === 1) return options[0];
    const deals = G.sample(seat, priv, pub, n, rng);
    const max = G.maximizes(seat);
    const [lo, hi] = G.bounds(pub);
    const goal = (max ? hi : lo) * deals.length;
    const hidden = G.isHidden(pub);
    let best = options[0], bestV = null;
    for (const a of options) {
      // window: only "strictly better than the best so far" needs an exact value
      const al = max && bestV !== null ? bestV : -INF, be = !max && bestV !== null ? bestV : INF;
      const v = hidden
        ? value(seat, G.play(pub, a), deals.map((d) => G.applyHidden(d, pub, a)), level, rng, al, be)
        : value(seat, G.play(pub, a), deals, level, rng, al, be);
      if (bestV === null || (max ? v > bestV : v < bestV)) { bestV = v; best = a; }
      if (bestV === goal) break; // early exit: cannot do better in any deal
    }
    return best;
  }

  // A modeled seat's decision is a deterministic function of its information
  // set (holding + public record) and the root's noise, so it is computed once
  // per information set and reused (cache cleared per root decision).
  let cache = new Map();
  function modeled(seat, mine, pub, level) {
    const key = level < 2 ? '' : `${level},${seat},${mine},${pub.phase},${pub.turn},${pub.passes},${pub.trump},${pub.maker},${pub.played},${pub.tc},${pub.tl},${pub.leader},${pub.t0},${pub.t1},${pub.voids}`;
    const hit = level >= 2 ? cache.get(key) : undefined;
    if (hit !== undefined) return hit;
    const r = G.rngFrom(G.hash32(rootNonce, seat, mine, G.publicKey(pub), level));
    const a = decide(seat, mine, pub, level - 1, r, nAt(level - 1));
    if (level >= 2) cache.set(key, a);
    return a;
  }

  let rootNonce = 0;
  // bottom rung: uniform random legal. (cfg.det is a test hook that derives the
  // draw from the seat's information set, making value() deterministic so the
  // pruned and unpruned searches can be compared decision for decision.)
  const rand0 = (mine, pub, rng) => (cfg.det
    ? G.randomLegal(mine, pub, G.rngFrom(G.hash32(rootNonce, mine, G.publicKey(pub))))
    : G.randomLegal(mine, pub, rng));

  // value(...) = the card's value() (sum over deals of the integer payoff),
  // computed with a fail-soft (alpha, beta) window on that sum: a result
  // <= alpha is an upper bound, >= beta a lower bound, otherwise exact. The
  // window only skips subtrees that cannot change the decider's argmax, so
  // the decision is the card's decision (random draws stay i.i.d.).
  function value(me, pub, deals, level, rng, alpha, beta) {
    stats.nodes++;
    if (cfg.noPrune) { alpha = -INF; beta = INF; }
    const done = G.outcome(pub);
    if (done !== null) return done * deals.length;
    const seat = G.toMove(pub);
    if (G.isHidden(pub)) {
      const next = G.play(pub, -1);
      if (seat === me) {
        const max = G.maximizes(me);
        let best = max ? -INF : INF;
        for (const a of G.legal(G.privateOf(deals[0], me, pub), pub)) {
          const v = value(me, next, deals.map((d) => G.applyHidden(d, pub, a)), level, rng,
            max ? Math.max(alpha, best) : alpha, max ? beta : Math.min(beta, best));
          if (max ? v > best : v < best) best = v;
          if (max ? best >= beta : best <= alpha) break;
        }
        return best;
      }
      const nd = deals.map((d) => {
        const mine = G.privateOf(d, seat, pub);
        const a = level === 0 ? rand0(mine, pub, rng) : modeled(seat, mine, pub, level);
        return G.applyHidden(d, pub, a);
      });
      return value(me, next, nd, level, rng, alpha, beta);
    }
    if (seat === me) { // one action for every deal I can't tell apart
      const max = G.maximizes(me);
      const [lo, hi] = G.bounds(pub);
      const goal = (max ? hi : lo) * deals.length;
      let best = max ? -INF : INF;
      for (const a of G.legal(G.privateOf(deals[0], me, pub), pub)) {
        const v = value(me, G.play(pub, a), deals, level, rng,
          max ? Math.max(alpha, best) : alpha, max ? beta : Math.min(beta, best));
        if (max ? v > best : v < best) best = v;
        if (best === goal || (max ? best >= beta : best <= alpha)) break;
      }
      return best;
    }
    // what does `seat` do in each deal?
    const acts = [], groups = [];
    for (const d of deals) {
      const mine = G.privateOf(d, seat, pub);
      const a = level === 0 ? rand0(mine, pub, rng) : modeled(seat, mine, pub, level);
      const gi = acts.indexOf(a);
      if (gi >= 0) groups[gi].push(d); else { acts.push(a); groups.push([d]); }
    }
    const [lo, hi] = G.bounds(pub);
    let sum = 0, restN = deals.length;
    for (let i = 0; i < acts.length; i++) {
      const g = groups[i];
      restN -= g.length; // deals in groups after this one
      const v = value(me, G.play(pub, acts[i]), g, level, rng,
        alpha - sum - restN * hi, beta - sum - restN * lo);
      sum += v;
      if (sum + restN * hi <= alpha) return sum + restN * hi;
      if (sum + restN * lo >= beta) return sum + restN * lo;
    }
    return sum;
  }

  return {
    cfg, stats,
    // Live entry point: the decider sees only (seat, priv, pub) and a seed.
    act(seat, priv, pub, seed) {
      rootNonce = seed >>> 0;
      cache = new Map();
      const rng = G.rngFrom(G.hash32(seed, 0x5eed));
      const inPlay = pub.phase === G.PLAY;
      const level = inPlay ? cfg.level : (cfg.bidLevel ?? cfg.level);
      const n = inPlay ? cfg.n : (cfg.bidN ?? cfg.n);
      return decide(seat, priv, pub, level, rng, n);
    },
  };
}
