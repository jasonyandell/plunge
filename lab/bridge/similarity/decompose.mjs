// Q1 support: variance decomposition, sampling-noise floor, calibration.
// EXPLORATORY tier.
//
//   node lab/bridge/similarity/decompose.mjs
import { loadCorpus, loadDeals, buildDataset, FEATURE_NAMES } from './data.mjs';

const here = (p) => new URL(p, import.meta.url).pathname;
const deals = loadDeals(here('../deals-test.json'));
const recs = buildDataset(loadCorpus(here('../results/pmake/selfplay.jsonl')), deals, 't');
const D = FEATURE_NAMES.length;

// ---------------------------------------------------------------- decomposition
const byDec = new Map();
for (const r of recs) { const a = byDec.get(r.decId) ?? []; a.push(r); byDec.set(r.decId, a); }
const mean = recs.reduce((s, r) => s + r.y, 0) / recs.length;
const varY = recs.reduce((s, r) => s + (r.y - mean) ** 2, 0) / recs.length;
let within = 0, noise = 0;
for (const a of byDec.values()) {
  const m = a.reduce((s, r) => s + r.y, 0) / a.length;
  for (const r of a) { within += (r.y - m) ** 2; noise += r.y * (1 - r.y) / 64; }
}
within /= recs.length; noise /= recs.length;
console.log(`var(y) = ${varY.toFixed(4)}  within-decision = ${within.toFixed(4)} (${(100 * within / varY).toFixed(1)}%)  between = ${(varY - within).toFixed(4)} (${(100 * (1 - within / varY)).toFixed(1)}%)`);
console.log(`binomial noise floor at n=64 (mean y(1-y)/64): ${noise.toFixed(4)} — ${(100 * noise / within).toFixed(0)}% of the within-decision variance`);

// ---------------------------------------------------------------- calibration (knn-25, 5-fold CV)
function knnCV(K) {
  const preds = new Float64Array(recs.length);
  for (let f = 0; f < 5; f++) {
    const trIdx = [], teIdx = [];
    recs.forEach((r, i) => (r.board % 5 === f ? teIdx : trIdx).push(i));
    const mu = new Float64Array(D), sd = new Float64Array(D);
    for (const i of trIdx) for (let j = 0; j < D; j++) mu[j] += recs[i].feat[j];
    for (let j = 0; j < D; j++) mu[j] /= trIdx.length;
    for (const i of trIdx) for (let j = 0; j < D; j++) sd[j] += (recs[i].feat[j] - mu[j]) ** 2;
    for (let j = 0; j < D; j++) sd[j] = Math.sqrt(sd[j] / trIdx.length) || 1;
    const X = new Float64Array(trIdx.length * D), Y = new Float64Array(trIdx.length);
    trIdx.forEach((ri, i) => { for (let j = 0; j < D; j++) X[i * D + j] = (recs[ri].feat[j] - mu[j]) / sd[j]; Y[i] = recs[ri].y; });
    for (const ti of teIdx) {
      const x = new Float64Array(D);
      for (let j = 0; j < D; j++) x[j] = (recs[ti].feat[j] - mu[j]) / sd[j];
      const bd = new Float64Array(K).fill(Infinity), bv = new Float64Array(K);
      for (let i = 0; i < trIdx.length; i++) {
        let d = 0; const o = i * D;
        for (let j = 0; j < D; j++) { const t = x[j] - X[o + j]; d += t * t; if (d >= bd[0]) break; }
        if (d < bd[0]) {
          bd[0] = d; bv[0] = Y[i];
          let w = 0;
          for (let m = 1; m < K; m++) if (bd[m] > bd[w]) w = m;
          if (w !== 0) { const td = bd[0]; bd[0] = bd[w]; bd[w] = td; const tv = bv[0]; bv[0] = bv[w]; bv[w] = tv; }
        }
      }
      let s = 0, n = 0;
      for (let m = 0; m < K; m++) if (bd[m] < Infinity) { s += bv[m]; n++; }
      preds[ti] = s / n;
    }
  }
  return preds;
}
const preds = knnCV(25);
console.log('\ncalibration, knn-25 (5-fold CV by board), 10 equal-width prediction bins:');
console.log('| predicted bin | n | mean predicted | mean actual |');
console.log('|---|---|---|---|');
for (let b = 0; b < 10; b++) {
  const lo = b / 10, hi = (b + 1) / 10;
  let n = 0, sp = 0, sa = 0;
  recs.forEach((r, i) => { const p = Math.min(preds[i], 0.9999); if (p >= lo && p < hi) { n++; sp += preds[i]; sa += r.y; } });
  if (n) console.log(`| [${lo.toFixed(1)}, ${hi.toFixed(1)}) | ${n} | ${(sp / n).toFixed(3)} | ${(sa / n).toFixed(3)} |`);
}
