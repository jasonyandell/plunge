// Checks for the taped Walt (tape.js). EXPLORATORY tier.
//  1. Information rule: with tape on, waltDecide returns the same card whether
//     `known` holds the whole deal or only the seats the agent may see.
//  2. Window algebra: pruned and unpruned searches choose the same card
//     (fail-soft alpha-beta on counts must not change the argmax or ties).
//  3. Purity: the same call twice returns the same card (no hidden state).
//   node lab/bridge/tapecheck.mjs
import { Rng, Pub, randomDeal, contractFor, legalCards, visibleSeats } from '../../public/lab/bridge/engine.js';
import { waltDecide, agentOf } from '../../public/lab/bridge/walt.js';
import SCORER_WEIGHTS from '../../public/lab/bridge/scorer-weights.js';

const rng = new Rng(424242);
let infoN = 0, pruneN = 0, pureN = 0, fullN = 0, scorerN = 0;
const hand = (d, s, p) => [0, 1, 2, 3].map((u) => d[s * 4 + u] & ~p.played[u]);

for (let g = 0; g < 25; g++) {
  const d = randomDeal(rng), ct = contractFor(d), p = new Pub(ct.decl, ct.strain, ct.level);
  while (p.n < 52 && p.outcome() < 0) {
    const seat = p.toMove(), agent = agentOf(p, seat);
    const L = legalCards(hand(d, seat, p), p);
    if (L.length > 1) {
      const seed = g * 1000 + p.n;
      // 1. information rule, tape on, modest settings
      if (p.n % 5 === 1) {
        const vis = visibleSeats(agent, p);
        const masked = new Uint16Array(16);
        for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) masked[s * 4 + u] = d[s * 4 + u];
        const cfg = { tape: true, n: 8, n0: 3, horizon: 8, seed };
        const a = waltDecide(p, agent, d, cfg).card, b = waltDecide(p, agent, masked, cfg).card;
        if (a !== b) throw new Error(`info rule: ${a} vs ${b} at game ${g} ply ${p.n}`);
        infoN++;
      }
      // 2. prune invariance at a horizon everywhere, and at full depth late
      if (p.n % 4 === 2) {
        const cfg = { tape: true, n: 8, n0: 2, horizon: 6, seed };
        const a = waltDecide(p, agent, d, cfg).card;
        const b = waltDecide(p, agent, d, { ...cfg, prune: false }).card;
        if (a !== b) throw new Error(`prune changed card (h6): ${a} vs ${b} at game ${g} ply ${p.n}`);
        pruneN++;
      }
      if (p.n >= 32 && p.n % 3 === 0) {
        const cfg = { tape: true, n: 12, n0: 3, horizon: 52, seed };
        const a = waltDecide(p, agent, d, cfg).card;
        const b = waltDecide(p, agent, d, { ...cfg, prune: false }).card;
        if (a !== b) throw new Error(`prune changed card (full): ${a} vs ${b} at game ${g} ply ${p.n}`);
        fullN++;
      }
      if (p.n >= 20 && p.n % 3 === 1) {
        const cfg = { tape: true, n: 12, n0: 2, horizon: 52, margin: false, k: 2, seed };
        const a = waltDecide(p, agent, d, cfg).card;
        const b = waltDecide(p, agent, d, { ...cfg, prune: false }).card;
        if (a !== b) throw new Error(`prune changed card (k2 full): ${a} vs ${b} at game ${g} ply ${p.n}`);
        fullN++;
      }
      // 2b. scorer minds: information rule + purity (only when weights exist)
      if (SCORER_WEIGHTS && p.n % 6 === 4) {
        const vis = visibleSeats(agent, p);
        const masked = new Uint16Array(16);
        for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) masked[s * 4 + u] = d[s * 4 + u];
        const cfg = { tape: true, n: 12, n0: 4, horizon: 52, margin: false, selfs: 'mind', l0: 'scorer', l0Tail: 12, k: 2, seed: g * 100 + p.n };
        const a = waltDecide(p, agent, d, cfg).card, b = waltDecide(p, agent, masked, cfg).card;
        if (a !== b) throw new Error(`scorer info rule: ${a} vs ${b} at game ${g} ply ${p.n}`);
        if (waltDecide(p, agent, d, cfg).card !== a) throw new Error(`scorer impure at game ${g} ply ${p.n}`);
        scorerN++;
      }
      // 3. purity
      if (p.n % 11 === 7) {
        const cfg = { tape: true, n: 8, n0: 3, horizon: 10, seed };
        if (waltDecide(p, agent, d, cfg).card !== waltDecide(p, agent, d, cfg).card) throw new Error('impure');
        pureN++;
      }
    }
    p.apply(L[rng.int(L.length)]);
  }
}
console.log(`tape info-rule: ${infoN} ok; prune-invariance h6: ${pruneN} ok, full-depth: ${fullN} ok; purity: ${pureN} ok; scorer info+purity: ${SCORER_WEIGHTS ? scorerN + ' ok' : 'skipped (no weights)'}`);
