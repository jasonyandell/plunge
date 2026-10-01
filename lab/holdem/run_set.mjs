// Run a list of duplicate matches, appending one JSON line each to results/h2h.jsonl.
// Usage: node run_set.mjs seed "A:B:deals" ["A:B:deals" ...]
import { appendFileSync } from 'fs';
import { runMatch, summarize } from './h2h.mjs';
const [seed, ...specs] = process.argv.slice(2);
for (const sp of specs) {
  const [a, b, d] = sp.split(':');
  const t0 = Date.now();
  const r = { ...summarize(runMatch(a, b, +d, +seed)), seed: +seed, wallSec: Math.round((Date.now() - t0) / 1000), cmd: `node h2h.mjs ${a} ${b} ${d} ${seed}` };
  console.log(JSON.stringify(r));
  appendFileSync(new URL('./results/h2h.jsonl', import.meta.url), JSON.stringify(r) + '\n');
}
