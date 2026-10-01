// Generate the h2h deal set: seeded random deals, contract by the engine's
// deterministic rule, screened by double dummy to "tight" contracts
// (DD declarer tricks within one of the target). EXPLORATORY tier.
//   DDS_PYTHON=<venv>/bin/python node lab/bridge/deals.mjs --seed 2026 --count 120 > lab/bridge/deals.json
import { Rng, randomDeal, contractFor, toPBN, contractText } from '../../public/lab/bridge/engine.js';
import { DDS } from './dds.mjs';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const seed = Number(arg('seed', 2026)), count = Number(arg('count', 120)), slack = Number(arg('slack', 1));
const dds = new DDS();
const rng = new Rng(seed);
const out = [];
let tried = 0;
while (out.length < count) {
  const batch = [];
  for (let i = 0; i < 20; i++) { const d = randomDeal(rng); batch.push({ d, ct: contractFor(d), idx: tried++ }); }
  for (const b of batch) {
    const [dd] = await dds.call({ op: 'dd', pbns: [toPBN(b.d)], trump: b.ct.strain, decl: b.ct.decl });
    const target = 6 + b.ct.level;
    if (Math.abs(dd - target) <= slack && out.length < count) {
      out.push({ i: b.idx, pbn: toPBN(b.d), decl: b.ct.decl, strain: b.ct.strain, level: b.ct.level, dd, contract: contractText(b.ct) });
    }
  }
}
dds.close();
process.stderr.write(`kept ${out.length} of ${tried} deals (|dd-target| <= ${slack})\n`);
process.stdout.write(JSON.stringify({ seed, slack, tried, deals: out }, null, 0).replace(/},{/g, '},\n{') + '\n');
