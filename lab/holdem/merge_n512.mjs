// Merge chunk lines (from chunk_n512.mjs) into one summary + behavior table.
import { readFileSync } from 'fs';
import { summarize } from './h2h.mjs';
const lines = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l)).sort((x, y) => x.from - y.from);
const res = [], tab = {}; const tA = { ms: 0, n: 0, max: 0 }; let wall = 0;
for (const c of lines) {
  res.push(...c.res); tA.ms += c.tA.ms; tA.n += c.tA.n; tA.max = Math.max(tA.max, c.tA.max); wall += c.wallSec;
  for (const [k, rows] of Object.entries(c.tab)) { tab[k] = tab[k] || rows.map(() => [0, 0, 0]); rows.forEach((r, i) => r.forEach((v, j) => (tab[k][i][j] += v))); }
}
const tB = { ms: 0, n: 0, max: 0 };
console.log(JSON.stringify({ ...summarize({ A: lines[0].A, B: lines[0].B, res, tA, tB }), seed: lines[0].seed, wallSec: wall, chunks: lines.map((c) => [c.from, c.to]) }));
console.log('rows: street/situation; cols: equity-vs-random quintile 0-20%..80-100%; cell f/c/r counts (open: c = check, r = bet)');
for (const k of Object.keys(tab).sort()) console.log(k.padEnd(13), tab[k].map((x) => x.join('/').padStart(10)).join(' '));
