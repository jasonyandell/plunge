// Summarize duplicate h2h JSONL files: node lab/spades/summarize.mjs f1.jsonl [f2 ...]
// Per deal, `diff` = A's zero-sum payoff summed over both tables (A as N/S, then
// A as E/W on the same cards). Integers per deal; the mean/CI below are reporting only.
import fs from 'node:fs';

for (const f of process.argv.slice(2)) {
  const rows = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const seen = new Set();
  const R = rows.filter((r) => (seen.has(r.deal) ? false : (seen.add(r.deal), true)));
  const n = R.length;
  const d = R.map((r) => r.diff);
  let sum = 0;
  for (const x of d) sum += x;
  const mean = sum / n;
  let ss = 0;
  for (const x of d) ss += (x - mean) * (x - mean);
  const sd = Math.sqrt(ss / (n - 1));
  const half = (1.96 * sd) / Math.sqrt(n);
  const w = d.filter((x) => x > 0).length, l = d.filter((x) => x < 0).length;
  let aMade = 0, bMade = 0, aOver = 0, bOver = 0, aT = 0, bT = 0, msA = 0, msB = 0;
  for (const r of R)
    for (const t of [r.t1, r.t2]) {
      if (t.aTricks >= t.aBid) { aMade++; aOver += t.aTricks - t.aBid; }
      if (t.bTricks >= t.bBid) { bMade++; bOver += t.bTricks - t.bBid; }
      aT += t.aTricks;
      bT += t.bTricks;
      msA += t.msA;
      msB += t.msB;
    }
  // McNemar-style: contracts made by A's side but not B's on the same cards/seats
  let aOnly = 0, bOnly = 0;
  for (const r of R) {
    // seats 0/2 cards: A at t1, B at t2 ; seats 1/3 cards: B at t1, A at t2
    const aNS = r.t1.aTricks >= r.t1.aBid, bNS = r.t2.bTricks >= r.t2.bBid;
    const aEW = r.t2.aTricks >= r.t2.aBid, bEW = r.t1.bTricks >= r.t1.bBid;
    if (aNS && !bNS) aOnly++;
    if (bNS && !aNS) bOnly++;
    if (aEW && !bEW) aOnly++;
    if (bEW && !aEW) bOnly++;
  }
  console.log(`${f}\n  A=${R[0].A}  B=${R[0].B}  seed=${R[0].seed} deals=${n} (x2 tables)`);
  console.log(`  dup diff per deal (A minus B, both tables): mean ${mean.toFixed(2)}  95% CI [${(mean - half).toFixed(2)}, ${(mean + half).toFixed(2)}]  sd ${sd.toFixed(1)}`);
  console.log(`  deals A ahead / level / behind: ${w} / ${n - w - l} / ${l}`);
  console.log(`  contracts made: A ${aMade}/${2 * n}  B ${bMade}/${2 * n}  (same cards: A-only ${aOnly}, B-only ${bOnly})`);
  console.log(`  bags (overtricks when made): A ${aOver}  B ${bOver};  tricks A ${aT} B ${bT}`);
  console.log(`  ms/move (mean of per-table means): A ${(msA / (2 * n)).toFixed(1)}  B ${(msB / (2 * n)).toFixed(1)}`);
}
