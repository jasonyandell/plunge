// Self-checks for the bridge engine and Walt (EXPLORATORY tier):
//  1. apply/undo round-trips the public state;
//  2. sampleDeals keeps the agent's visible hands, hand sizes and revealed voids;
//  3. information rule at the root: waltDecide gives the same card whether `known`
//     holds the whole deal or only the seats the agent may see.
//   node lab/bridge/selfcheck.mjs
import { Rng, Pub, randomDeal, contractFor, legalCards, sampleDeals, visibleSeats, popcount, SUIT } from '../../public/lab/bridge/engine.js';
import { waltDecide, agentOf } from '../../public/lab/bridge/walt.js';

const rng = new Rng(12345);
let undoOk = 0, samples = 0, infoOk = 0, infoN = 0;
const snap = (p) => JSON.stringify([p.n, p.leader, p.tl, Array.from(p.tc.slice(0, p.tl)), p.declTricks, p.defTricks, Array.from(p.played), Array.from(p.done), Array.from(p.voids), Array.from(p.cnt)]);
const hand = (d, s, p) => [0, 1, 2, 3].map((u) => d[s * 4 + u] & ~p.played[u]);
for (let g = 0; g < 40; g++) {
  const d = randomDeal(rng), ct = contractFor(d), p = new Pub(ct.decl, ct.strain, ct.level);
  while (p.n < 52) {
    const seat = p.toMove(), agent = agentOf(p, seat);
    // 2. sampler lawfulness
    const vis = visibleSeats(agent, p);
    for (const w of sampleDeals(p, vis, d, 4, rng)) {
      samples++;
      for (let s = 0; s < 4; s++) {
        const h = hand(w, s, p);
        if (h.reduce((a, m) => a + popcount(m), 0) !== 13 - p.cnt[s]) throw new Error('hand size');
        for (let u = 0; u < 4; u++) {
          if ((vis & (1 << s)) && h[u] !== (d[s * 4 + u] & ~p.played[u])) throw new Error('visible hand changed');
          if ((p.voids[s] & (1 << u)) && h[u]) throw new Error('void violated');
        }
      }
      let all = 0; for (let i = 0; i < 16; i++) all += popcount(w[i] & ~p.played[i & 3]);
      if (all !== 52 - p.n) throw new Error('card count');
    }
    // 3. information rule (every 7th position, cheap settings)
    if (p.n % 7 === 3 && legalCards(hand(d, seat, p), p).length > 1) {
      const masked = new Uint16Array(16);
      for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) masked[s * 4 + u] = d[s * 4 + u];
      const cfg = { n: 8, n0: 3, horizon: 6, seed: g * 100 + p.n };
      const a = waltDecide(p, agent, d, cfg).card, b = waltDecide(p, agent, masked, cfg).card;
      infoN++; if (a === b) infoOk++; else throw new Error(`info rule: ${a} vs ${b} at game ${g} ply ${p.n}`);
    }
    // 1. apply/undo round trip on a random legal card, then play a random card
    const L = legalCards(hand(d, seat, p), p);
    const before = snap(p);
    p.apply(L[0]); p.undo();
    if (snap(p) === before) undoOk++; else throw new Error('undo mismatch');
    p.apply(L[rng.int(L.length)]);
    void SUIT;
  }
}
console.log(`apply/undo round trips: ${undoOk} ok; sampled deals checked: ${samples}; information-rule invariance: ${infoOk}/${infoN}`);
