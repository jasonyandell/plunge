// Summarize h2h result files (JSON lines from h2h.mjs). EXPLORATORY tier.
//   node lab/bridge/summarize.mjs lab/bridge/results/*.jsonl
// Reporting only: the 95% intervals use the normal approximation on the
// per-board duplicate differences (floating point is confined to this report).
import { readFileSync } from 'node:fs';

const ci = (xs) => {
  const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1);
  const h = 1.96 * Math.sqrt(v / n);
  return `${m >= 0 ? '+' : ''}${m.toFixed(3)} [${(m - h).toFixed(3)}, ${(m + h).toFixed(3)}]`;
};
const pct = (k, n) => `${k}/${n} (${Math.round((100 * k) / n)}%)`;

for (const f of process.argv.slice(2)) {
  const rows = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const n = rows.length, A = rows[0].a, B = rows[0].b;
  console.log(`\n## ${f.split('/').pop()}  (A = ${A}, B = ${B}, ${n} boards, boards ${rows[0].board}..${rows[n - 1].board})`);
  const tabs = Object.keys(rows[0].tables);
  for (const t of tabs) {
    const k = rows.filter((r) => r.tables[t].made).length;
    console.log(`table ${t} (${t[0] === 'A' ? A : B} declares vs ${t[1] === 'A' ? A : B}): made ${pct(k, n)}`);
  }
  const pair = (x, y, label) => {
    if (!tabs.includes(x) || !tabs.includes(y)) return;
    const d = rows.map((r) => r.tables[x].made - r.tables[y].made);
    const w = d.filter((v) => v > 0).length, l = d.filter((v) => v < 0).length;
    console.log(`${label}: made(${x}) - made(${y}) = ${ci(d)}  (+1: ${w}, 0: ${n - w - l}, -1: ${l})`);
  };
  pair('AB', 'BA', 'duplicate (A minus B, both seats)');
  pair('AB', 'BB', 'declarer play vs B defence (A minus B)');
  pair('BB', 'BA', 'defence vs B declarer (A minus B)');
  pair('AA', 'BA', 'declarer play vs A defence (A minus B)');
  pair('AB', 'AA', 'defence vs A declarer (A minus B)');
  // timing per player, per seat role
  const times = { A: [], B: [] };
  for (const r of rows) for (const t of tabs) { times[t[0]].push(...r.tables[t].times.decl); times[t[1]].push(...r.tables[t].times.def); }
  for (const p of ['A', 'B']) {
    const ts = times[p].slice().sort((a, b) => a - b);
    if (!ts.length) continue;
    const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
    console.log(`ms/move ${p === 'A' ? A : B}: mean ${avg.toFixed(0)}, median ${ts[ts.length >> 1]}, p90 ${ts[Math.floor(ts.length * 0.9)]}, max ${ts[ts.length - 1]} over ${ts.length} moves`);
  }
}
