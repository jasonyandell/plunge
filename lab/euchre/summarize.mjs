// Summarize a duplicate h2h jsonl: per-deal A points (sum over both seatings).
// usage: node lab/euchre/summarize.mjs file.jsonl [...]
import fs from 'node:fs';

for (const f of process.argv.slice(2)) {
  const recs = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const n = recs.length;
  const xs = recs.map((r) => r.aPts); // integer, both halves
  const sum = xs.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  const half = 1.96 * sd / Math.sqrt(n);
  const won = xs.filter((x) => x > 0).length, lost = xs.filter((x) => x < 0).length;
  const makes = (k) => recs.filter((r) => r.m1 === k).length + recs.filter((r) => r.m2 === k).length;
  // per hand = per deal / 2
  console.log(`${f}: ${n} deals (${2 * n} hands). A net points ${sum} (sum over deals).`);
  console.log(`  per deal (both seatings): mean ${mean.toFixed(3)} +/- ${half.toFixed(3)} (95% CI [${(mean - half).toFixed(3)}, ${(mean + half).toFixed(3)}])`);
  console.log(`  per hand: ${(mean / 2).toFixed(3)} +/- ${(half / 2).toFixed(3)}`);
  console.log(`  deals A ahead / tied / behind: ${won} / ${n - won - lost} / ${lost}; contracts made by A ${makes('A')}, by B ${makes('B')}, passed out ${makes('-')}`);
}
