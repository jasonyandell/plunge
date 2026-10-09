// Validation for the similarity data layer. EXPLORATORY tier.
//
//   node lab/bridge/similarity/checks.mjs [--repro N]
//
// 1. Rebuilds every corpus position (seat, legality, outcome invariants are
//    asserted inside buildDataset) and prints dataset stats.
// 2. --repro N: re-runs waltDecide at N randomly chosen corpus decisions with
//    the corpus config + per-decision seed and asserts the returned pmake
//    vector is byte-identical to the stored one (purity / play-invariance of
//    the mind field means a cold cache must reproduce the collected values).
import { loadCorpus, loadDeals, buildDataset, parsePBN, cardFromText } from './data.mjs';
import { Pub, mix, visibleSeats, Rng } from '../../../public/lab/bridge/engine.js';
import { waltDecide, agentOf } from '../../../public/lab/bridge/walt.js';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const nRepro = Number(arg('repro', 0));

const deals = loadDeals(new URL('../deals-test.json', import.meta.url).pathname);
const rows = loadCorpus(new URL('../results/pmake/selfplay.jsonl', import.meta.url).pathname);
const recs = buildDataset(rows, deals, 'test-s1');

const nDec = new Set(recs.map((r) => r.decId)).size;
const ys = recs.map((r) => r.y);
const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
const varY = ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length;
let contested = 0;
const seen = new Set();
for (const r of recs) if (!seen.has(r.decId)) { seen.add(r.decId); if (r.vMax - r.vMin >= 4) contested++; }
console.log(`boards ${rows.length}  decisions ${nDec}  candidates ${recs.length}`);
console.log(`y: mean ${mean.toFixed(4)}  var ${varY.toFixed(4)}  (all deals=64: ${recs.every((r) => r.deals === 64)})`);
console.log(`contested decisions (spread >= 4/64): ${contested}/${nDec}`);
console.log('reconstruction invariants: OK (no assertion threw)');

if (nRepro > 0) {
  const cfg = { tape: true, n: 64, n0: 32, horizon: 52, margin: false, selfs: 'mind', l0: 'flat', l0Tail: 28, k: 2, vector: true };
  const rng = new Rng(7);
  const decIds = [...new Set(recs.map((r) => r.decId))];
  const pickIds = new Set();
  while (pickIds.size < Math.min(nRepro, decIds.length)) pickIds.add(decIds[rng.int(decIds.length)]);
  let ok = 0;
  for (const row of rows) {
    const deal = parsePBN(deals[row.board].pbn);
    const pub = new Pub(row.decl, row.strain, row.level);
    const plays = row.plays.split(' ').map(cardFromText);
    const byPly = new Map(row.vectors.map((v) => [v.ply, v]));
    const base = mix(row.seed, row.board);
    for (let i = 0; i < plays.length; i++) {
      const vec = byPly.get(pub.n);
      const rec = vec && recs.find((r) => r.tag === 'test-s1' && r.board === row.board && r.ply === pub.n);
      if (vec && rec && pickIds.has(rec.decId)) {
        const seat = pub.toMove(), agent = agentOf(pub, seat);
        const vis = visibleSeats(agent, pub);
        const known = new Uint16Array(16);
        for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) known[s * 4 + u] = deal[s * 4 + u];
        const t0 = performance.now();
        const r = waltDecide(pub, agent, known, { ...cfg, seed: mix(base, pub.n) });
        const ms = performance.now() - t0;
        const got = JSON.stringify(r.values), want = JSON.stringify(vec.v);
        if (got !== want) throw new Error(`repro mismatch b${row.board} ply${pub.n}\n got ${got}\nwant ${want}`);
        if (r.card !== vec.pick) throw new Error(`pick mismatch b${row.board} ply${pub.n}`);
        ok++;
        console.log(`repro ok b${row.board} ply${pub.n} (${vec.v.length} cands, ${ms.toFixed(0)} ms)`);
      }
      pub.apply(plays[i]);
    }
  }
  console.log(`reproduced ${ok}/${pickIds.size} decisions byte-identically`);
}
