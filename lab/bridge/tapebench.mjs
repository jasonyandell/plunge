// Per-move timing for a Walt config, self-play on test boards. EXPLORATORY tier.
//   node lab/bridge/tapebench.mjs --cfg '{"tape":true,"n":32,"n0":8,"horizon":52}' --from 0 --to 3
// Walt plays all four seats. Prints per-ply ms and search stats, then a summary.
import { readFileSync } from 'node:fs';
import { Pub, mix, visibleSeats, SUIT, RANK } from '../../public/lab/bridge/engine.js';
import { waltDecide, agentOf } from '../../public/lab/bridge/walt.js';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const cfg = JSON.parse(arg('cfg', '{"tape":true,"n":32,"n0":8,"horizon":52}'));
const from = Number(arg('from', 0)), to = Number(arg('to', 3));
const seed = Number(arg('seed', 1));
const quiet = process.argv.includes('--quiet');
const { deals } = JSON.parse(readFileSync(new URL(arg('deals', './deals-test.json'), import.meta.url), 'utf8'));

function parsePBN(pbn) {
  const d = new Uint16Array(16);
  const R = '23456789TJQKA';
  pbn.slice(2).split(' ').forEach((hand, s) => hand.split('.').forEach((cards, k) => {
    const u = 3 - k; for (const ch of cards) d[s * 4 + u] |= 1 << R.indexOf(ch);
  }));
  return d;
}

const all = [];
for (let b = from; b < Math.min(to, deals.length); b++) {
  const D = deals[b];
  const deal = parsePBN(D.pbn), ct = { decl: D.decl, strain: D.strain, level: D.level };
  const pub = new Pub(ct.decl, ct.strain, ct.level);
  const base = mix(seed, b);
  while (pub.outcome() < 0) {
    const seat = pub.toMove(), agent = agentOf(pub, seat);
    const vis = visibleSeats(agent, pub);
    const known = new Uint16Array(16);
    for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) known[s * 4 + u] = deal[s * 4 + u];
    const t0 = performance.now();
    const r = waltDecide(pub, agent, known, { ...cfg, seed: mix(base, pub.n) });
    const dt = performance.now() - t0;
    all.push({ b, ply: pub.n, ms: dt, forced: r.forced, st: r.stats });
    if (!quiet && !r.forced && dt > 1) {
      const s = r.stats;
      console.log(`b${b} ply ${String(pub.n).padStart(2)} ${(dt).toFixed(0).padStart(6)} ms  nodes ${String(s.nodes).padStart(9)}  minds ${String(s.minds).padStart(7)}  hits ${s.mindHits ?? 0}  rollouts ${s.rollouts}`);
    }
    if (!(deal[seat * 4 + SUIT[r.card]] & (1 << RANK[r.card]))) throw new Error('illegal card');
    pub.apply(r.card);
  }
  console.log(`board ${b} ${D.contract}: ${pub.outcome() ? 'made' : 'down'} decl=${pub.declTricks} def=${pub.defTricks}`);
}
const real = all.filter((x) => !x.forced).map((x) => x.ms).sort((a, b2) => a - b2);
const q = (p) => real[Math.min(real.length - 1, Math.floor(p * real.length))].toFixed(0);
const mean = (real.reduce((a, x) => a + x, 0) / real.length).toFixed(0);
console.log(`decisions ${real.length}: mean ${mean} median ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${q(1 - 1e-9)} ms`);
