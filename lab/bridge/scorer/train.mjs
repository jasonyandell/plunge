// Train the lawful-feature scorer (the 42 "feat-s64" recipe, bridged):
// per-candidate features -> 64 -> 64 -> 1, soft-target BCE against the
// full-depth Walt teacher's pmake rate, argmax at inference. EXPLORATORY tier.
//
// Training data: tune-board self-play corpora (deals-tune.json boards 0-119,
// several seeds). The 60-board test set is never read here.
// Selection (A2-style): by held-out decision REGRET of the argmax policy on
// validation boards, not by MSE. The final weights are the selected net,
// trained only on the training boards (no unvalidated retrain-on-all).
//
//   node lab/bridge/scorer/train.mjs [--epochs 30,60] [--seeds 11,22,33] [--out public/lab/bridge/scorer-weights.js]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { loadDeals, loadCorpus, buildDataset } from '../similarity/data.mjs';
import { FEATURE_NAMES } from '../../../public/lab/bridge/features.js';
import { Rng } from '../../../public/lab/bridge/engine.js';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const EPOCH_POINTS = arg('epochs', '30,60').split(',').map(Number);
const SEEDS = arg('seeds', '11,22,33').split(',').map(Number);
const OUT = arg('out', new URL('../../../public/lab/bridge/scorer-weights.js', import.meta.url).pathname);
const VAL_FROM = Number(arg('valFrom', 96)); // boards >= this are validation

const here = (p) => new URL(p, import.meta.url).pathname;
const deals = loadDeals(here('../deals-tune.json'));
const dir = here('../results/pmake');
const seen = new Set();
const rows = [];
for (const f of readdirSync(dir).filter((f) => f.startsWith('tune-')).sort()) {
  for (const r of loadCorpus(dir + '/' + f)) {
    const key = r.seed + ':' + r.board;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }
}
console.log(`corpus: ${rows.length} board-plays, seeds ${[...new Set(rows.map((r) => r.seed))].join(',')}`);
const recs = buildDataset(rows, deals, 'tune');
const D = FEATURE_NAMES.length;
const train = recs.filter((r) => r.board < VAL_FROM);
const val = recs.filter((r) => r.board >= VAL_FROM);
console.log(`records: ${recs.length} candidates (${train.length} train / ${val.length} val), D=${D}`);

const byDec = (rs) => {
  const m = new Map();
  for (const r of rs) { const a = m.get(r.decId) ?? []; a.push(r); m.set(r.decId, a); }
  return [...m.values()];
};
const valDecs = byDec(val);

/** Directed regret of picking `pick` at one decision (make-rate units). */
function regretOf(decRecs, pickIdx) {
  const maxi = decRecs[0].feat[7] === 1;
  let best = maxi ? -Infinity : Infinity;
  for (const r of decRecs) best = maxi ? Math.max(best, r.y) : Math.min(best, r.y);
  const y = decRecs[pickIdx].y;
  return maxi ? best - y : y - best;
}
function policyRegret(decs, pickFn) {
  let s = 0, agree = 0;
  for (const d of decs) {
    const i = pickFn(d);
    const reg = regretOf(d, i);
    s += reg;
    if (reg === 0) agree++;
  }
  return { regret: s / decs.length, bestSet: agree / decs.length };
}

// Baselines
const maxiOf = (d) => d[0].feat[7] === 1;
const base = {
  random: (() => { // expected regret of a uniform pick
    let s = 0;
    for (const d of valDecs) { let t = 0; for (let i = 0; i < d.length; i++) t += regretOf(d, i); s += t / d.length; }
    return { regret: s / valDecs.length, bestSet: NaN };
  })(),
  rule: policyRegret(valDecs, (d) => { const i = d.findIndex((r) => r.feat[28] === 1); return i < 0 ? 0 : i; }),
  teacher: policyRegret(valDecs, (d) => d.findIndex((r) => r.pick === 1)),
};

// ------------------------------------------------------------------ training
const H1 = 64, H2 = 64;
function trainNet(data, seed, epochPoints, evalFn) {
  const lr = 3e-3, b1m = 0.9, b2m = 0.999, eps = 1e-8;
  const rng = new Rng(seed);
  const gauss = () => { let s = 0; for (let i = 0; i < 12; i++) s += rng.next() / 4294967296; return s - 6; };
  const mu = new Float64Array(D), sd = new Float64Array(D);
  for (const r of data) for (let j = 0; j < D; j++) mu[j] += r.feat[j];
  for (let j = 0; j < D; j++) mu[j] /= data.length;
  for (const r of data) for (let j = 0; j < D; j++) sd[j] += (r.feat[j] - mu[j]) ** 2;
  for (let j = 0; j < D; j++) sd[j] = Math.sqrt(sd[j] / data.length) || 1;
  const P = { W1: new Float64Array(H1 * D), b1: new Float64Array(H1), W2: new Float64Array(H2 * H1), b2: new Float64Array(H2), W3: new Float64Array(H2), b3: new Float64Array(1) };
  for (let i = 0; i < P.W1.length; i++) P.W1[i] = gauss() / Math.sqrt(D);
  for (let i = 0; i < P.W2.length; i++) P.W2[i] = gauss() / Math.sqrt(H1);
  for (let i = 0; i < P.W3.length; i++) P.W3[i] = gauss() / Math.sqrt(H2);
  const M = {}, V = {};
  for (const k of Object.keys(P)) { M[k] = new Float64Array(P[k].length); V[k] = new Float64Array(P[k].length); }
  const x = new Float64Array(D), h1 = new Float64Array(H1), h2 = new Float64Array(H2);
  const g2 = new Float64Array(H2), g1 = new Float64Array(H1);
  let t = 0;
  const fwd = (feat) => {
    for (let j = 0; j < D; j++) x[j] = (feat[j] - mu[j]) / sd[j];
    for (let i = 0; i < H1; i++) { let s = P.b1[i]; const o = i * D; for (let j = 0; j < D; j++) s += P.W1[o + j] * x[j]; h1[i] = Math.tanh(s); }
    for (let i = 0; i < H2; i++) { let s = P.b2[i]; const o = i * H1; for (let j = 0; j < H1; j++) s += P.W2[o + j] * h1[j]; h2[i] = Math.tanh(s); }
    let z = P.b3[0]; for (let j = 0; j < H2; j++) z += P.W3[j] * h2[j];
    return z;
  };
  const idx = data.map((_, i) => i);
  const results = [];
  for (let e = 1; e <= Math.max(...epochPoints); e++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = rng.int(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (const i of idx) {
      const r = data[i];
      const z = fwd(r.feat);
      const dOut = 1 / (1 + Math.exp(-z)) - r.y; // BCE gradient on soft target
      t++;
      const step = (k, gi, gv) => {
        M[k][gi] = b1m * M[k][gi] + (1 - b1m) * gv; V[k][gi] = b2m * V[k][gi] + (1 - b2m) * gv * gv;
        P[k][gi] -= lr * (M[k][gi] / (1 - b1m ** t)) / (Math.sqrt(V[k][gi] / (1 - b2m ** t)) + eps);
      };
      for (let j = 0; j < H2; j++) { g2[j] = dOut * P.W3[j] * (1 - h2[j] * h2[j]); step('W3', j, dOut * h2[j]); }
      step('b3', 0, dOut);
      for (let j = 0; j < H1; j++) g1[j] = 0;
      for (let i2 = 0; i2 < H2; i2++) {
        const o = i2 * H1;
        for (let j = 0; j < H1; j++) { g1[j] += g2[i2] * P.W2[o + j]; step('W2', o + j, g2[i2] * h1[j]); }
        step('b2', i2, g2[i2]);
      }
      for (let i2 = 0; i2 < H1; i2++) {
        const gh = g1[i2] * (1 - h1[i2] * h1[i2]), o = i2 * D;
        for (let j = 0; j < D; j++) step('W1', o + j, gh * x[j]);
        step('b1', i2, gh);
      }
    }
    if (epochPoints.includes(e)) {
      const snap = { D, H1, H2, mu: [...mu], sd: [...sd], W1: [...P.W1], b1: [...P.b1], W2: [...P.W2], b2: [...P.b2], W3: [...P.W3], b3: P.b3[0] };
      results.push({ epochs: e, snap, eval: evalFn(fwd) });
    }
  }
  return results;
}

const evalOnVal = (fwd) => policyRegret(valDecs, (d) => {
  const maxi = maxiOf(d);
  let bi = 0, bz = maxi ? -Infinity : Infinity;
  for (let i = 0; i < d.length; i++) { const z = fwd(d[i].feat); if (maxi ? z > bz : z < bz) { bz = z; bi = i; } }
  return bi;
});

console.log(`val decisions: ${valDecs.length}`);
console.log(`baseline regret: random ${base.random.regret.toFixed(4)}; rule ${base.rule.regret.toFixed(4)} (best-set ${base.rule.bestSet.toFixed(3)}); teacher-pick ${base.teacher.regret.toFixed(4)}`);

let best = null;
for (const seed of SEEDS) {
  const t0 = performance.now();
  for (const r of trainNet(train, seed, EPOCH_POINTS, evalOnVal)) {
    console.log(`seed ${seed} e${r.epochs}: val regret ${r.eval.regret.toFixed(4)}, best-set ${r.eval.bestSet.toFixed(3)}  (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
    if (!best || r.eval.regret < best.eval.regret) best = { seed, ...r };
  }
}
const retained = (base.random.regret - best.eval.regret) / (base.random.regret - base.teacher.regret);
console.log(`selected: seed ${best.seed} e${best.epochs} — val regret ${best.eval.regret.toFixed(4)}, retained ${(retained).toFixed(2)} of random->teacher, best-set ${best.eval.bestSet.toFixed(3)}`);

const W = best.snap;
const params = W.W1.length + W.b1.length + W.W2.length + W.b2.length + W.W3.length + 1;
writeFileSync(OUT, `// Trained lawful-feature scorer weights (generated by lab/bridge/scorer/train.mjs).
// ${params} parameters; arch ${D}->${H1}->${H2}->1 (tanh, logit out); soft-BCE on the
// full-depth Walt teacher's pmake rates; trained on deals-tune boards 0-${VAL_FROM - 1}
// (seeds ${[...new Set(rows.map((r) => r.seed))].join(',')}), selected by argmax-policy regret on boards ${VAL_FROM}-119:
// val regret ${best.eval.regret.toFixed(4)} (random ${base.random.regret.toFixed(4)}, rule ${base.rule.regret.toFixed(4)}, teacher ${base.teacher.regret.toFixed(4)}), retained ${retained.toFixed(2)}, seed ${best.seed}, epochs ${best.epochs}.
export default ${JSON.stringify(W)};
`);
console.log(`wrote ${OUT} (${params} params)`);
