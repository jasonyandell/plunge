// Self-checks behind REPORT.md claims (exploratory, not a CI gate):
//  1. every sampled deal is lawful (own holding, sizes, voids, up card, kitty, discard);
//  2. the exact DP sampler and rejection sampling agree on card-location marginals;
//  3. the (alpha, beta) window in Walt's value() never changes a decision
//     (deterministic bottom rung so pruned/unpruned runs are comparable);
//  4. P(up card still in dealer's hand | non-dealer, start of play) = 5/6.
// usage: node lab/euchre/checks.mjs      (~1-2 min)
import * as G from '../../public/lab/euchre/engine.js';
import { makeRule } from '../../public/lab/euchre/bots.js';
import { makeWalt } from '../../public/lab/euchre/walt.js';

const rule = makeRule();
function* states(nHands, seed) {
  for (let h = 0; h < nHands; h++) {
    const rng = G.rngFrom(G.hash32(seed, h));
    const { deal: d0, up } = G.randomDeal(rng);
    let deal = d0.slice(), pub = G.newPublic(h & 3, up);
    while (pub.phase !== G.DONE) {
      const seat = pub.turn, priv = G.privateOf(deal, seat, pub);
      yield { h, seat, priv, pub, deal, up, rng };
      const a = rule.act(seat, priv, pub);
      if (G.isHidden(pub)) deal = G.applyHidden(deal, pub, a);
      pub = G.play(pub, a);
    }
  }
}

// 1 + 4
let checked = 0, upIn = 0, upTot = 0;
for (const { seat, priv, pub, up, rng } of states(200, 11)) {
  for (const d of G.sample(seat, priv, pub, 20, rng)) {
    if (G.privateOf(d, seat, pub) !== priv) throw new Error('own holding changed');
    let all = 0;
    for (let s = 0; s < 4; s++) {
      const m = G.privateOf(d, s, pub) & G.ALL;
      if (all & m) throw new Error('card in two hands');
      all |= m;
      if (G.popcount(m) !== G.handSize(pub, s)) throw new Error('hand size');
      if (pub.phase === G.PLAY) for (let su = 0; su < 4; su++) if ((pub.voids >>> (s * 4 + su)) & 1 && (m & G.SUITMASK[pub.trump][su])) throw new Error('void violated');
    }
    if (all & pub.played) throw new Error('played card held');
    if (G.popcount(d[4]) !== 3 || (d[4] & (all | pub.played))) throw new Error('kitty');
    if (pub.picked && pub.phase === G.PLAY) {
      if (d[5] < 0 || ((1 << d[5]) & (all | d[4] | pub.played))) throw new Error('discard slot');
      if (!((1 << up) & (all | pub.played)) && d[5] !== up) throw new Error('up card lost');
      if (seat !== pub.dealer && pub.trick === 0 && pub.tl === 0) { upTot++; if (G.privateOf(d, pub.dealer, pub) & (1 << up)) upIn++; }
    }
    const tot = all | d[4] | pub.played | (d[5] >= 0 ? 1 << d[5] : 0) | (pub.phase === G.BID1 || !pub.picked ? 1 << up : 0);
    if (tot !== G.ALL) throw new Error('cards missing');
    checked++;
  }
}
console.log(`1. ${checked} sampled deals lawful`);
console.log(`4. P(up card in dealer hand | non-dealer, start of play) = ${(upIn / upTot).toFixed(4)} over ${upTot} samples (5/6 = 0.8333)`);

// 2
let tested = 0, worst = 0;
for (const { h, seat, priv, pub, rng } of states(400, 99)) {
  if (tested >= 4) break;
  if (!(pub.phase === G.PLAY && pub.picked && seat !== pub.dealer && G.popcount(pub.voids) >= 2 && pub.trick <= 2)) continue;
  const N = 30000;
  G.SAMPLER.maxTries = 0; // force the exact DP
  const a = G.sample(seat, priv, pub, N, rng);
  G.SAMPLER.maxTries = 64;
  const nov = { ...pub, voids: 0 }, b = [];
  while (b.length < N) {
    const [d] = G.sample(seat, priv, nov, 1, rng);
    let ok = true;
    for (let s = 0; s < 4; s++) for (let su = 0; su < 4; su++) if ((pub.voids >>> (s * 4 + su)) & 1 && (G.privateOf(d, s, pub) & G.SUITMASK[pub.trump][su])) ok = false;
    if (ok) b.push(d);
  }
  const marg = (ds) => {
    const m = new Array(24 * 6).fill(0);
    for (const d of ds) {
      for (let s = 0; s < 4; s++) for (const c of G.cardsOf(d[s] & ~pub.played)) m[c * 6 + s]++;
      for (const c of G.cardsOf(d[4])) m[c * 6 + 4]++;
      if (d[5] >= 0) m[d[5] * 6 + 5]++;
    }
    return m.map((x) => x / ds.length);
  };
  const ma = marg(a), mb = marg(b);
  let dev = 0;
  for (let i = 0; i < ma.length; i++) dev = Math.max(dev, Math.abs(ma[i] - mb[i]));
  worst = Math.max(worst, dev); tested++;
  console.log(`2. hand ${h}: voids ${pub.voids.toString(2)}, max |DP - rejection| marginal = ${dev.toFixed(4)} (N=${N} each; ~0.01 is sampling noise)`);
}

// 3
const P = makeWalt({ level: 1, n: 12, n0: 6, det: 1 }), U = makeWalt({ level: 1, n: 12, n0: 6, det: 1, noPrune: 1 });
let same = 0, diff = 0, nP = 0, nU = 0;
for (const { h, seat, priv, pub } of states(12, 5)) {
  if (G.legal(priv, pub).length < 2) continue;
  P.stats.nodes = 0; U.stats.nodes = 0;
  const s = G.hash32(h, pub.played, pub.turn, pub.phase);
  if (P.act(seat, priv, pub, s) === U.act(seat, priv, pub, s)) same++; else diff++;
  nP += P.stats.nodes; nU += U.stats.nodes;
}
console.log(`3. pruned vs unpruned Walt L1: ${same} identical decisions, ${diff} different; nodes ${nP} vs ${nU}`);
if (diff) process.exit(1);
