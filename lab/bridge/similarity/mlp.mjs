// Q1 honesty check: can a tiny nonlinear model predict the within-decision
// delta where ridge/kNN cannot? EXPLORATORY tier. Plain JS, no deps.
//
//   node lab/bridge/similarity/mlp.mjs
//
// MLP 33 -> 32 -> 16 -> 1 (tanh), Adam, MSE on delta = y - own-decision mean,
// 5-fold CV by board, 3 seeds averaged per fold.
import { loadCorpus, loadDeals, buildDataset, FEATURE_NAMES } from './data.mjs';
import { Rng } from '../../../public/lab/bridge/engine.js';

const here = (p) => new URL(p, import.meta.url).pathname;
const deals = loadDeals(here('../deals-test.json'));
const recs = buildDataset(loadCorpus(here('../results/pmake/selfplay.jsonl')), deals, 't');
const D = FEATURE_NAMES.length;

const byDec = new Map();
for (const r of recs) { const a = byDec.get(r.decId) ?? []; a.push(r); byDec.set(r.decId, a); }
for (const a of byDec.values()) { const m = a.reduce((s, r) => s + r.y, 0) / a.length; for (const r of a) r.delta = r.y - m; }

function trainMLP(train, seed, epochs = 60) {
  const H1 = 32, H2 = 16, lr = 3e-3, b1 = 0.9, b2 = 0.999, eps = 1e-8;
  const rng = new Rng(seed);
  const gauss = () => { let s = 0; for (let i = 0; i < 12; i++) s += rng.next() / 4294967296; return s - 6; };
  const mu = new Float64Array(D), sd = new Float64Array(D);
  for (const r of train) for (let j = 0; j < D; j++) mu[j] += r.feat[j];
  for (let j = 0; j < D; j++) mu[j] /= train.length;
  for (const r of train) for (let j = 0; j < D; j++) sd[j] += (r.feat[j] - mu[j]) ** 2;
  for (let j = 0; j < D; j++) sd[j] = Math.sqrt(sd[j] / train.length) || 1;
  const P = { W1: new Float64Array(H1 * D), b1v: new Float64Array(H1), W2: new Float64Array(H2 * H1), b2v: new Float64Array(H2), W3: new Float64Array(H2), b3v: new Float64Array(1) };
  for (let i = 0; i < P.W1.length; i++) P.W1[i] = gauss() / Math.sqrt(D);
  for (let i = 0; i < P.W2.length; i++) P.W2[i] = gauss() / Math.sqrt(H1);
  for (let i = 0; i < P.W3.length; i++) P.W3[i] = gauss() / Math.sqrt(H2);
  const M = {}, V = {};
  for (const k of Object.keys(P)) { M[k] = new Float64Array(P[k].length); V[k] = new Float64Array(P[k].length); }
  const x = new Float64Array(D), h1 = new Float64Array(H1), h2 = new Float64Array(H2);
  const g1 = new Float64Array(H1), g2 = new Float64Array(H2);
  let t = 0;
  const fwd = (feat) => {
    for (let j = 0; j < D; j++) x[j] = (feat[j] - mu[j]) / sd[j];
    for (let i = 0; i < H1; i++) { let s = P.b1v[i]; const o = i * D; for (let j = 0; j < D; j++) s += P.W1[o + j] * x[j]; h1[i] = Math.tanh(s); }
    for (let i = 0; i < H2; i++) { let s = P.b2v[i]; const o = i * H1; for (let j = 0; j < H1; j++) s += P.W2[o + j] * h1[j]; h2[i] = Math.tanh(s); }
    let out = P.b3v[0]; for (let j = 0; j < H2; j++) out += P.W3[j] * h2[j];
    return out;
  };
  const idx = train.map((_, i) => i);
  for (let e = 0; e < epochs; e++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = rng.int(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (const i of idx) {
      const r = train[i];
      const out = fwd(r.feat);
      const dOut = 2 * (out - r.delta);
      t++;
      const step = (k, gi, gv) => {
        M[k][gi] = b1 * M[k][gi] + (1 - b1) * gv; V[k][gi] = b2 * V[k][gi] + (1 - b2) * gv * gv;
        P[k][gi] -= lr * (M[k][gi] / (1 - b1 ** t)) / (Math.sqrt(V[k][gi] / (1 - b2 ** t)) + eps);
      };
      for (let j = 0; j < H2; j++) { g2[j] = dOut * P.W3[j] * (1 - h2[j] * h2[j]); step('W3', j, dOut * h2[j]); }
      step('b3v', 0, dOut);
      for (let j = 0; j < H1; j++) g1[j] = 0;
      for (let i2 = 0; i2 < H2; i2++) {
        const o = i2 * H1;
        for (let j = 0; j < H1; j++) { g1[j] += g2[i2] * P.W2[o + j]; step('W2', o + j, g2[i2] * h1[j]); }
        step('b2v', i2, g2[i2]);
      }
      for (let i2 = 0; i2 < H1; i2++) {
        const gh = g1[i2] * (1 - h1[i2] * h1[i2]), o = i2 * D;
        for (let j = 0; j < D; j++) step('W1', o + j, gh * x[j]);
        step('b1v', i2, gh);
      }
    }
  }
  return fwd;
}

let se = 0, n = 0, seY = 0;
for (let f = 0; f < 5; f++) {
  const test = recs.filter((r) => r.board % 5 === f), train = recs.filter((r) => r.board % 5 !== f);
  const preds = new Float64Array(test.length);
  const seeds = [11, 22, 33];
  for (const s of seeds) {
    const m = trainMLP(train, s);
    test.forEach((r, i) => { preds[i] += m(r.feat) / seeds.length; });
  }
  test.forEach((r, i) => { se += (preds[i] - r.delta) ** 2; n++; });
  console.error(`fold ${f} done`);
}
const vd = recs.reduce((s, r) => s + r.delta ** 2, 0) / recs.length;
console.log(`tiny MLP (33-32-16-1, 3-seed avg) on delta: test MSE ${(se / n).toFixed(5)} vs var(delta) ${vd.toFixed(5)}  R2 ${(1 - se / n / vd).toFixed(3)}`);
