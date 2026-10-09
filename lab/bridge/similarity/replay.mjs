// Replay corpus decisions through waltDecide at a given config, recording the
// per-decision pmake vector and cost (deterministic stats.nodes + wall ms).
// EXPLORATORY tier.
//
//   node lab/bridge/similarity/replay.mjs --cfg '{"n":64,"n0":32,...}' \
//     --from 0 --to 60 --out lab/bridge/similarity/results/replay-full-a.jsonl
//   --assert 1   require the replayed vector to equal the stored one (use with
//                the corpus config: validates purity on all decisions)
//
// Mirrors collect.mjs: one mind-field Map persists across a board's decisions;
// the per-decision seed is mix(mix(seed, board), ply). Only plies that carry a
// stored vector are re-decided (the play sequence itself comes from the corpus).
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCorpus, loadDeals, parsePBN, cardFromText } from './data.mjs';
import { Pub, mix, visibleSeats } from '../../../public/lab/bridge/engine.js';
import { waltDecide, agentOf } from '../../../public/lab/bridge/walt.js';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const here = (p) => new URL(p, import.meta.url).pathname;
const base = { tape: true, horizon: 52, margin: false, selfs: 'mind', l0: 'flat', vector: true };
const cfg = { ...base, ...JSON.parse(arg('cfg', '{"n":64,"n0":32,"l0Tail":28,"k":2}')) };
const from = Number(arg('from', 0)), to = Number(arg('to', 60));
const doAssert = arg('assert', '0') === '1';
const out = arg('out', null);
const dealsPath = arg('deals', here('../deals-test.json'));
const corpusPath = arg('corpus', here('../results/pmake/selfplay.jsonl'));

const deals = loadDeals(dealsPath);
const rows = loadCorpus(corpusPath);
if (out) mkdirSync(dirname(out), { recursive: true });

for (const row of rows) {
  if (row.board < from || row.board >= to) continue;
  const deal = parsePBN(deals[row.board].pbn);
  const pub = new Pub(row.decl, row.strain, row.level);
  const plays = row.plays.split(' ').map(cardFromText);
  const byPly = new Map(row.vectors.map((v) => [v.ply, v]));
  const seedBase = mix(row.seed, row.board);
  const field = new Map();
  const decs = [];
  const t0 = performance.now();
  for (let i = 0; i < plays.length; i++) {
    const vec = byPly.get(pub.n);
    if (vec) {
      const seat = pub.toMove(), agent = agentOf(pub, seat);
      const vis = visibleSeats(agent, pub);
      const known = new Uint16Array(16);
      for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) known[s * 4 + u] = deal[s * 4 + u];
      const td = performance.now();
      const r = waltDecide(pub, agent, known, { ...cfg, seed: mix(seedBase, pub.n), fieldMap: field });
      const ms = performance.now() - td;
      if (doAssert) {
        if (JSON.stringify(r.values) !== JSON.stringify(vec.v)) throw new Error(`vector mismatch b${row.board} ply${pub.n}`);
        if (r.card !== vec.pick) throw new Error(`pick mismatch b${row.board} ply${pub.n}`);
      }
      decs.push({ ply: pub.n, seat, pick: r.card, v: r.values, nodes: r.stats.nodes, minds: r.stats.minds, ms: Math.round(ms * 10) / 10 });
    }
    pub.apply(plays[i]);
  }
  const line = { board: row.board, seed: row.seed, cfg: JSON.stringify(cfg), decs };
  console.log(`board ${row.board}: ${decs.length} decisions ${(performance.now() - t0).toFixed(0)} ms${doAssert ? ' (verified)' : ''}`);
  if (out) appendFileSync(out, JSON.stringify(line) + '\n');
}
