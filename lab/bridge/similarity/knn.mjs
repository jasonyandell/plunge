// Q1: do alike positions have alike pmake vectors? EXPLORATORY tier.
//
//   node lab/bridge/similarity/knn.mjs                     # 5-fold CV over selfplay.jsonl boards
//   node lab/bridge/similarity/knn.mjs --train tune        # train on tune corpus, test on selfplay
//   node lab/bridge/similarity/knn.mjs --train tune --frac 0.25 --reps 4   # scaling point
//
// Predicts a candidate's make-rate (makes/64) from cheap public features.
// Splits are ALWAYS by board (never within a board). Baselines: global mean,
// strain mean, strain x level mean, and the same-position-other-candidate mean
// (uses the test vector itself - not deployable, bounds within-position info).
import { readdirSync } from 'node:fs';
import { loadCorpus, loadDeals, buildDataset, FEATURE_NAMES } from './data.mjs';
import { Rng } from '../../../public/lab/bridge/engine.js';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const here = (p) => new URL(p, import.meta.url).pathname;

const testDeals = loadDeals(here('../deals-test.json'));
const selfplay = buildDataset(loadCorpus(here('../results/pmake/selfplay.jsonl')), testDeals, 'test-s1');

export function loadTuneCorpus(seeds = null) {
  // seeds: e.g. ['s1','s2'] pins the corpus for reproducibility; null = all
  const tuneDeals = loadDeals(here('../deals-tune.json'));
  const dir = here('../results/pmake');
  const recs = [];
  for (const f of readdirSync(dir).filter((f) => /^tune-s\d+-[a-z]\.jsonl$/.test(f)).sort()) {
    const seed = f.match(/^tune-(s\d+)/)[1];
    if (seeds && !seeds.includes(seed)) continue;
    recs.push(...buildDataset(loadCorpus(`${dir}/${f}`), tuneDeals, `tune-${seed}`));
  }
  return recs;
}

// ---------------------------------------------------------------- models
const D = FEATURE_NAMES.length;

function standardizer(train) {
  const mu = new Float64Array(D), sd = new Float64Array(D);
  for (const r of train) for (let j = 0; j < D; j++) mu[j] += r.feat[j];
  for (let j = 0; j < D; j++) mu[j] /= train.length;
  for (const r of train) for (let j = 0; j < D; j++) sd[j] += (r.feat[j] - mu[j]) ** 2;
  for (let j = 0; j < D; j++) sd[j] = Math.sqrt(sd[j] / train.length) || 1;
  return (f, out) => { for (let j = 0; j < D; j++) out[j] = (f[j] - mu[j]) / sd[j]; return out; };
}

function knnModel(train, k) {
  const z = standardizer(train);
  const X = new Float64Array(train.length * D), Y = new Float64Array(train.length);
  const buf = new Float64Array(D);
  train.forEach((r, i) => { z(r.feat, buf); X.set(buf, i * D); Y[i] = r.y; });
  return (feat) => {
    z(feat, buf);
    // k smallest distances by insertion into a fixed-size worst-first list
    const bd = new Float64Array(k).fill(Infinity), bv = new Float64Array(k);
    for (let i = 0; i < train.length; i++) {
      let d = 0; const o = i * D;
      for (let j = 0; j < D; j++) { const t = buf[j] - X[o + j]; d += t * t; if (d >= bd[0]) break; }
      if (d < bd[0]) {
        // replace current worst, re-find worst
        bd[0] = d; bv[0] = Y[i];
        let w = 0;
        for (let m = 1; m < k; m++) if (bd[m] > bd[w]) w = m;
        if (w !== 0) { const td = bd[0]; bd[0] = bd[w]; bd[w] = td; const tv = bv[0]; bv[0] = bv[w]; bv[w] = tv; }
      }
    }
    let s = 0, n = 0;
    for (let m = 0; m < k; m++) if (bd[m] < Infinity) { s += bv[m]; n++; }
    return s / n;
  };
}

function ridgeModel(train, lambda) {
  const z = standardizer(train);
  const d1 = D + 1, buf = new Float64Array(D);
  const A = Array.from({ length: d1 }, () => new Float64Array(d1 + 1));
  for (const r of train) {
    z(r.feat, buf);
    for (let i = 0; i < d1; i++) {
      const xi = i < D ? buf[i] : 1;
      for (let j = 0; j < d1; j++) A[i][j] += xi * (j < D ? buf[j] : 1);
      A[i][d1] += xi * r.y;
    }
  }
  for (let i = 0; i < D; i++) A[i][i] += lambda;
  // gaussian elimination with partial pivoting
  for (let c = 0; c < d1; c++) {
    let p = c;
    for (let r2 = c + 1; r2 < d1; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[p][c])) p = r2;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r2 = 0; r2 < d1; r2++) if (r2 !== c && A[r2][c]) {
      const f = A[r2][c] / A[c][c];
      for (let j = c; j <= d1; j++) A[r2][j] -= f * A[c][j];
    }
  }
  const beta = new Float64Array(d1);
  for (let i = 0; i < d1; i++) beta[i] = A[i][d1] / A[i][i];
  return (feat) => {
    z(feat, buf);
    let s = beta[D];
    for (let j = 0; j < D; j++) s += beta[j] * buf[j];
    return s;
  };
}

// ---------------------------------------------------------------- evaluation
function strainLevelMeans(train) {
  const m = new Map();
  for (const r of train) {
    const isNT = r.feat[0], lvl = r.feat[1];
    for (const key of ['g', `s${isNT}`, `sl${isNT}:${lvl}`]) {
      const e = m.get(key) ?? [0, 0]; e[0] += r.y; e[1]++; m.set(key, e);
    }
  }
  return m;
}

/** Evaluate predictions on test records. preds: Map decKey->Float64Array or fn. */
function metrics(test, predict) {
  let se = 0, ae = 0, n = 0;
  const byDec = new Map();
  for (const r of test) {
    const p = Math.max(0, Math.min(1, predict(r)));
    se += (p - r.y) ** 2; ae += Math.abs(p - r.y); n++;
    let d = byDec.get(r.decId);
    if (!d) byDec.set(r.decId, d = { recs: [], preds: [] });
    d.recs.push(r); d.preds.push(p);
  }
  // per-decision: does the model's pick match the true argbest? regret in make-prob
  let top1 = 0, nd = 0, regret = 0, top1C = 0, ndC = 0, regretC = 0;
  for (const { recs, preds } of byDec.values()) {
    if (recs.length < 2) continue;
    const maxi = recs[0].feat[7] === 1; // isDeclSide
    let bi = 0, ti = 0;
    for (let i = 1; i < recs.length; i++) {
      if (maxi ? preds[i] > preds[bi] : preds[i] < preds[bi]) bi = i;
      if (maxi ? recs[i].y > recs[ti].y : recs[i].y < recs[ti].y) ti = i;
    }
    const reg = Math.abs(recs[ti].y - recs[bi].y);
    const hit = recs[bi].y === recs[ti].y ? 1 : 0; // value-tie counts as a hit
    nd++; top1 += hit; regret += reg;
    if (recs[0].vMax - recs[0].vMin >= 4) { ndC++; top1C += hit; regretC += reg; }
  }
  return {
    mse: se / n, mae: ae / n, n,
    top1: top1 / nd, regret: regret / nd, nd,
    top1C: top1C / ndC, regretC: regretC / ndC, ndC,
  };
}

function evalSplit(train, test, models) {
  const sl = strainLevelMeans(train);
  const g = sl.get('g')[0] / sl.get('g')[1];
  const out = {};
  out['global-mean'] = metrics(test, () => g);
  out['strain-mean'] = metrics(test, (r) => { const e = sl.get(`s${r.feat[0]}`); return e ? e[0] / e[1] : g; });
  out['strain-level-mean'] = metrics(test, (r) => { const e = sl.get(`sl${r.feat[0]}:${r.feat[1]}`); return e ? e[0] / e[1] : g; });
  // same-position-other-candidate mean (test-side oracle for position identity)
  const sums = new Map();
  for (const r of test) { const e = sums.get(r.decId) ?? [0, 0]; e[0] += r.y; e[1]++; sums.set(r.decId, e); }
  out['other-cand-mean*'] = metrics(test, (r) => { const [s, c] = sums.get(r.decId); return c > 1 ? (s - r.y) / (c - 1) : g; });
  for (const [name, make] of Object.entries(models)) {
    const m = make(train);
    out[name] = metrics(test, (r) => m(r.feat));
  }
  return out;
}

function printTable(title, results) {
  console.log(`\n### ${title}`);
  console.log('| model | MSE | MAE | top-1 | regret | top-1 (contested) | regret (contested) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [name, m] of Object.entries(results)) {
    console.log(`| ${name} | ${m.mse.toFixed(4)} | ${m.mae.toFixed(4)} | ${(m.top1 * 100).toFixed(1)}% | ${m.regret.toFixed(4)} | ${(m.top1C * 100).toFixed(1)}% | ${m.regretC.toFixed(4)} |`);
  }
}

const avg = (list) => {
  const out = {};
  for (const name of Object.keys(list[0])) {
    out[name] = {};
    for (const k of Object.keys(list[0][name])) out[name][k] = list.reduce((a, r) => a + r[name][k], 0) / list.length;
  }
  return out;
};

// ---------------------------------------------------------------- main
const allModels = {
  'knn-1': (tr) => knnModel(tr, 1),
  'knn-5': (tr) => knnModel(tr, 5),
  'knn-10': (tr) => knnModel(tr, 10),
  'knn-25': (tr) => knnModel(tr, 25),
  'ridge-1': (tr) => ridgeModel(tr, 1),
};
const pick = arg('models', null);
const models = pick ? Object.fromEntries(pick.split(',').map((k) => [k, allModels[k]])) : allModels;

if (import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const mode = arg('train', 'cv');
  if (mode === 'cv') {
    const folds = 5;
    const per = [];
    for (let f = 0; f < folds; f++) {
      const test = selfplay.filter((r) => r.board % folds === f);
      const train = selfplay.filter((r) => r.board % folds !== f);
      per.push(evalSplit(train, test, models));
      console.error(`fold ${f}: train ${train.length} test ${test.length}`);
    }
    printTable(`5-fold CV by board over selfplay.jsonl (${selfplay.length} candidates, 60 boards)`, avg(per));
    console.log('\nper-fold MSE spread:');
    for (const name of Object.keys(per[0])) {
      const v = per.map((p) => p[name].mse);
      console.log(`  ${name}: ${v.map((x) => x.toFixed(4)).join(' ')}  (min ${Math.min(...v).toFixed(4)} max ${Math.max(...v).toFixed(4)})`);
    }
  } else if (mode === 'tune') {
    const seeds = arg('seeds', null);
    let train = loadTuneCorpus(seeds ? seeds.split(',') : null);
    const frac = Number(arg('frac', 1)), reps = Number(arg('reps', 1));
    const groups = [...new Set(train.map((r) => r.group))];
    const per = [];
    for (let rep = 0; rep < reps; rep++) {
      let tr = train;
      if (frac < 1) {
        const rng = new Rng(1234 + rep), g = groups.slice();
        for (let i = g.length - 1; i > 0; i--) { const j = rng.int(i + 1); [g[i], g[j]] = [g[j], g[i]]; }
        const keep = new Set(g.slice(0, Math.max(1, Math.round(groups.length * frac))));
        tr = train.filter((r) => keep.has(r.group));
      }
      per.push(evalSplit(tr, selfplay, models));
      console.error(`rep ${rep}: train ${per.at(-1)['global-mean'].n ? tr.length : 0} candidates, ${new Set(tr.map((r) => r.group)).size} board-seeds`);
    }
    printTable(`train=tune corpus (frac ${frac}, ${reps} rep${reps > 1 ? 's' : ''}), test=selfplay.jsonl`, avg(per));
  }
}
