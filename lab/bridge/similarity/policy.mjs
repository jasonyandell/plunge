// Q2: how much does a prior save? Cost-regret curves for decision policies.
// EXPLORATORY tier.
//
//   node lab/bridge/similarity/policy.mjs
//
// Truth = the n=64 exact vectors in selfplay.jsonl. The full-config replay
// reproduced every vector byte-identically, so "refine candidate set S at full
// settings" returns exactly the stored values; a policy that refines S picks
// truth-argbest within S. Costs are deterministic node counts from replays:
//   - full evaluation of a decision: its replay-full nodes
//   - cheap blunt pass: its replay-n{8,16} nodes
//   - refining subset S: nodes_full * |S|/|cands|  (PROXY - vector mode
//     evaluates each candidate independently over the same deals, but subtree
//     sizes differ per candidate; flagged in the report)
//   - kNN prior / gate: free at play time (table lookup into the corpus)
// Prior models are trained with board-level hygiene (5-fold CV over boards, or
// --train tune for the tune-deal corpus).
import { loadCorpus, loadDeals, buildDataset, FEATURE_NAMES } from './data.mjs';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const here = (p) => new URL(p, import.meta.url).pathname;

// ---------------------------------------------------------------- load
const deals = loadDeals(here('../deals-test.json'));
const truthRows = loadCorpus(here('../results/pmake/selfplay.jsonl'));
const recs = buildDataset(truthRows, deals, 'test-s1');
const D = FEATURE_NAMES.length;

function loadReplay(paths) {
  const m = new Map(); // board -> ply -> dec
  for (const p of paths) for (const r of loadCorpus(p)) {
    let b = m.get(r.board); if (!b) m.set(r.board, b = new Map());
    for (const d of r.decs) b.set(d.ply, d);
  }
  return m;
}
const full = loadReplay(['replay-full-a.jsonl', 'replay-full-b.jsonl', 'replay-full-c.jsonl'].map((f) => here(`results/${f}`)));
const cheap8 = loadReplay([here('results/replay-n8-n04.jsonl')]);
const cheap16 = loadReplay([here('results/replay-n16-n08.jsonl')]);

// ---------------------------------------------------------------- decisions
// One entry per decision: truth values, candidate order (rule card first),
// per-candidate features, cheap vectors, node costs.
const byDec = new Map();
for (const r of recs) { const a = byDec.get(r.decId) ?? []; a.push(r); byDec.set(r.decId, a); }
const decisions = [];
for (const a of byDec.values()) {
  const { board, ply } = a[0];
  const maxi = a[0].feat[7] === 1;
  const fd = full.get(board)?.get(ply);
  if (!fd) continue; // replay still incomplete
  const y = a.map((r) => r.y);
  const best = maxi ? Math.max(...y) : Math.min(...y);
  decisions.push({
    board, ply, maxi, cands: a.map((r) => r.card), y, best,
    feats: a.map((r) => r.feat), vMax: a[0].vMax, vMin: a[0].vMin,
    nodesFull: fd.nodes,
    cheap8: cheap8.get(board)?.get(ply) ?? null,
    cheap16: cheap16.get(board)?.get(ply) ?? null,
  });
}
const meanFullNodes = decisions.reduce((s, d) => s + d.nodesFull, 0) / decisions.length;
console.error(`decisions with full replay: ${decisions.length}; mean full nodes/decision ${Math.round(meanFullNodes)}`);

// ---------------------------------------------------------------- priors (CV by board)
// Candidate-level kNN-25 on y, and decision-level kNN-25 on skip-regret.
function knnTables(trainRecs) {
  const mu = new Float64Array(D), sd = new Float64Array(D);
  for (const r of trainRecs) for (let j = 0; j < D; j++) mu[j] += r.feat[j];
  for (let j = 0; j < D; j++) mu[j] /= trainRecs.length;
  for (const r of trainRecs) for (let j = 0; j < D; j++) sd[j] += (r.feat[j] - mu[j]) ** 2;
  for (let j = 0; j < D; j++) sd[j] = Math.sqrt(sd[j] / trainRecs.length) || 1;
  const X = new Float64Array(trainRecs.length * D), Y = new Float64Array(trainRecs.length);
  trainRecs.forEach((r, i) => { for (let j = 0; j < D; j++) X[i * D + j] = (r.feat[j] - mu[j]) / sd[j]; Y[i] = r.y; });
  return { mu, sd, X, Y, n: trainRecs.length };
}
function knnQuery(T, feat, K) {
  const x = new Float64Array(D);
  for (let j = 0; j < D; j++) x[j] = (feat[j] - T.mu[j]) / T.sd[j];
  const bd = new Float64Array(K).fill(Infinity), bv = new Float64Array(K);
  for (let i = 0; i < T.n; i++) {
    let d = 0; const o = i * D;
    for (let j = 0; j < D; j++) { const t = x[j] - T.X[o + j]; d += t * t; if (d >= bd[0]) break; }
    if (d < bd[0]) {
      bd[0] = d; bv[0] = T.Y[i];
      let w = 0;
      for (let m = 1; m < K; m++) if (bd[m] > bd[w]) w = m;
      if (w !== 0) { const td = bd[0]; bd[0] = bd[w]; bd[w] = td; const tv = bv[0]; bv[0] = bv[w]; bv[w] = tv; }
    }
  }
  let s = 0, n = 0;
  for (let m = 0; m < K; m++) if (bd[m] < Infinity) { s += bv[m]; n++; }
  return s / n;
}

// decision-level gate training rows: features = position block + aggregates
function gateFeat(d) {
  const p = d.feats[0].slice(0, 16);
  const agg = [d.cands.length];
  for (const j of [20, 21, 23, 24]) {
    let mn = Infinity, mx = -Infinity, s = 0;
    for (const f of d.feats) { const v = f[j]; mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; }
    agg.push(mn, mx, s / d.feats.length);
  }
  return [...p, ...agg];
}
const GD = gateFeat(decisions[0]).length;
function gateTables(trainDecs) {
  const rows = trainDecs.map((d) => ({ feat: gateFeat(d), y: Math.abs(d.best - d.y[0]) }));
  const T = { mu: new Float64Array(GD), sd: new Float64Array(GD), X: new Float64Array(rows.length * GD), Y: new Float64Array(rows.length), n: rows.length };
  for (const r of rows) for (let j = 0; j < GD; j++) T.mu[j] += r.feat[j];
  for (let j = 0; j < GD; j++) T.mu[j] /= rows.length;
  for (const r of rows) for (let j = 0; j < GD; j++) T.sd[j] += (r.feat[j] - T.mu[j]) ** 2;
  for (let j = 0; j < GD; j++) T.sd[j] = Math.sqrt(T.sd[j] / rows.length) || 1;
  rows.forEach((r, i) => { for (let j = 0; j < GD; j++) T.X[i * GD + j] = (r.feat[j] - T.mu[j]) / T.sd[j]; T.Y[i] = r.y; });
  return T;
}
function gateQuery(T, feat, K) {
  const x = new Float64Array(GD);
  for (let j = 0; j < GD; j++) x[j] = (feat[j] - T.mu[j]) / T.sd[j];
  const bd = new Float64Array(K).fill(Infinity), bv = new Float64Array(K);
  for (let i = 0; i < T.n; i++) {
    let d = 0; const o = i * GD;
    for (let j = 0; j < GD; j++) { const t = x[j] - T.X[o + j]; d += t * t; if (d >= bd[0]) break; }
    if (d < bd[0]) {
      bd[0] = d; bv[0] = T.Y[i];
      let w = 0;
      for (let m = 1; m < K; m++) if (bd[m] > bd[w]) w = m;
      if (w !== 0) { const td = bd[0]; bd[0] = bd[w]; bd[w] = td; const tv = bv[0]; bv[0] = bv[w]; bv[w] = tv; }
    }
  }
  let s = 0, n = 0;
  for (let m = 0; m < K; m++) if (bd[m] < Infinity) { s += bv[m]; n++; }
  return s / n;
}

// attach CV prior predictions to each decision
const folds = 5;
for (let f = 0; f < folds; f++) {
  const trainRecs = recs.filter((r) => r.board % folds !== f);
  const trainDecs = decisions.filter((d) => d.board % folds !== f);
  const T = knnTables(trainRecs), G = gateTables(trainDecs);
  for (const d of decisions) if (d.board % folds === f) {
    d.prior = d.feats.map((ft) => knnQuery(T, ft, 25));
    d.gate = gateQuery(G, gateFeat(d), 25);
  }
  console.error(`fold ${f} priors done`);
}

// ---------------------------------------------------------------- policies
// Each policy maps a decision -> { cost (nodes), pickVal }.
const regretOf = (d, val) => Math.abs(d.best - val);
const restrictBest = (d, set) => {
  let bv = null;
  for (let i = 0; i < d.cands.length; i++) if (set.has(d.cands[i])) {
    const v = d.y[i];
    if (bv === null || (d.maxi ? v > bv : v < bv)) bv = v;
  }
  return bv ?? d.y[0];
};
const cheapOrder = (d, cv) => {
  // candidates sorted best-first by the cheap vector's estimates (tie: listed order)
  const est = new Map(cv.v.map(([a, m, n]) => [a, m / n]));
  return d.cands.slice().sort((a, b) => (d.maxi ? est.get(b) - est.get(a) : est.get(a) - est.get(b)));
};

function evalPolicy(name, fn) {
  let cost = 0, reg = 0, hit = 0;
  for (const d of decisions) {
    const r = fn(d);
    cost += r.cost; reg += regretOf(d, r.pickVal);
    if (r.pickVal === d.best) hit++;
  }
  return { name, cost: cost / decisions.length / meanFullNodes, reg: reg / decisions.length, hit: hit / decisions.length };
}

const results = [];
results.push(evalPolicy('rule-first (no search)', (d) => ({ cost: 0, pickVal: d.y[0] })));
results.push(evalPolicy('knn prior pick (no search)', (d) => {
  let bi = 0;
  for (let i = 1; i < d.prior.length; i++) if (d.maxi ? d.prior[i] > d.prior[bi] : d.prior[i] < d.prior[bi]) bi = i;
  return { cost: 0, pickVal: d.y[bi] };
}));
for (const [nm, cheap] of [['n8/n04', 'cheap8'], ['n16/n08', 'cheap16']]) {
  results.push(evalPolicy(`${nm} pick`, (d) => {
    const cv = d[cheap]; if (!cv) return { cost: 0, pickVal: d.y[0] };
    const ord = cheapOrder(d, cv);
    return { cost: cv.nodes, pickVal: d.y[d.cands.indexOf(ord[0])] };
  }));
  for (const m of [2, 3]) {
    results.push(evalPolicy(`${nm} + refine top-${m}`, (d) => {
      const cv = d[cheap]; if (!cv) return { cost: 0, pickVal: d.y[0] };
      const S = new Set(cheapOrder(d, cv).slice(0, m));
      return { cost: cv.nodes + d.nodesFull * (Math.min(m, d.cands.length) / d.cands.length), pickVal: restrictBest(d, S) };
    }));
  }
}
for (const m of [2, 3]) {
  results.push(evalPolicy(`knn finalists top-${m} (refine only)`, (d) => {
    const idx = d.cands.map((_, i) => i).sort((a, b) => (d.maxi ? d.prior[b] - d.prior[a] : d.prior[a] - d.prior[b]));
    const S = new Set(idx.slice(0, m).map((i) => d.cands[i]));
    return { cost: d.nodesFull * (Math.min(S.size, d.cands.length) / d.cands.length), pickVal: restrictBest(d, S) };
  }));
}
results.push(evalPolicy('knn top-1 + rule (refine 2)', (d) => {
  let bi = 0;
  for (let i = 1; i < d.prior.length; i++) if (d.maxi ? d.prior[i] > d.prior[bi] : d.prior[i] < d.prior[bi]) bi = i;
  const S = new Set([d.cands[0], d.cands[bi]]);
  return { cost: d.nodesFull * (S.size / d.cands.length), pickVal: restrictBest(d, S) };
}));
// control: does any second card next to the rule card do as well as a chosen one?
{
  let ctr = 0;
  results.push(evalPolicy('rule + arbitrary other (refine 2) [control]', (d) => {
    const others = d.cands.slice(1);
    const S = new Set([d.cands[0], others[ctr++ % Math.max(1, others.length)]]);
    return { cost: d.nodesFull * (S.size / d.cands.length), pickVal: restrictBest(d, S) };
  }));
}
// eps-adaptive finalists: refine everything the estimator can't separate from its best
for (const [nm, cheap] of [['n8/n04', 'cheap8'], ['n16/n08', 'cheap16']]) {
  for (const eps of [2 / 64, 4 / 64]) {
    results.push(evalPolicy(`${nm} + refine eps=${(eps * 64).toFixed(0)}/64`, (d) => {
      const cv = d[cheap]; if (!cv) return { cost: 0, pickVal: d.y[0] };
      const est = new Map(cv.v.map(([a, m, n]) => [a, m / n]));
      const bestE = (d.maxi ? Math.max : Math.min)(...est.values());
      const S = new Set(d.cands.filter((a) => Math.abs(est.get(a) - bestE) <= eps));
      return { cost: cv.nodes + d.nodesFull * (S.size / d.cands.length), pickVal: restrictBest(d, S) };
    }));
  }
}
for (const eps of [0.05, 0.1]) {
  results.push(evalPolicy(`knn finalists eps=${eps} (refine only)`, (d) => {
    const bestP = (d.maxi ? Math.max : Math.min)(...d.prior);
    const S = new Set(d.cands.filter((_, i) => Math.abs(d.prior[i] - bestP) <= eps));
    S.add(d.cands[0]);
    return { cost: d.nodesFull * (S.size / d.cands.length), pickVal: restrictBest(d, S) };
  }));
}
for (const tau of [0.01, 0.02, 0.04, 0.08]) {
  results.push(evalPolicy(`gate(tau=${tau}) -> full`, (d) => (d.gate >= tau ? { cost: d.nodesFull, pickVal: d.best } : { cost: 0, pickVal: d.y[0] })));
}
for (const tau of [0.01, 0.02, 0.04]) {
  results.push(evalPolicy(`gate(tau=${tau}) -> n16+refine top-2`, (d) => {
    if (d.gate < tau) return { cost: 0, pickVal: d.y[0] };
    const cv = d.cheap16; if (!cv) return { cost: d.nodesFull, pickVal: d.best };
    const S = new Set(cheapOrder(d, cv).slice(0, 2));
    return { cost: cv.nodes + d.nodesFull * (Math.min(2, d.cands.length) / d.cands.length), pickVal: restrictBest(d, S) };
  }));
}
results.push(evalPolicy('full Walt', (d) => ({ cost: d.nodesFull, pickVal: d.best })));

console.log('\n| policy | cost (x full) | mean regret | best-value pick % |');
console.log('|---|---|---|---|');
for (const r of results) console.log(`| ${r.name} | ${r.cost.toFixed(3)} | ${r.reg.toFixed(4)} | ${(r.hit * 100).toFixed(1)}% |`);
