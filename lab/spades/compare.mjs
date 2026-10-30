// Paired comparison of two h2h runs against the same opponent on the same deals:
// node lab/spades/compare.mjs runX.jsonl runY.jsonl  -> mean (X.diff - Y.diff) with 95% CI.
import fs from 'node:fs';
const load = (f) => new Map(fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((r) => [r.deal, r]));
const [X, Y] = process.argv.slice(2).map(load);
const d = [];
for (const [k, r] of X) if (Y.has(k)) d.push(r.diff - Y.get(k).diff);
const n = d.length, m = d.reduce((a, b) => a + b, 0) / n;
const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1));
const mx = [...X.values()].filter((r) => Y.has(r.deal)).reduce((a, r) => a + r.diff, 0) / n;
const my = [...Y.values()].filter((r) => X.has(r.deal)).reduce((a, r) => a + r.diff, 0) / n;
console.log(`common deals ${n}: X mean ${mx.toFixed(2)}  Y mean ${my.toFixed(2)}  X-Y ${m.toFixed(2)} 95% CI [${(m - 1.96 * sd / Math.sqrt(n)).toFixed(2)}, ${(m + 1.96 * sd / Math.sqrt(n)).toFixed(2)}]`);
