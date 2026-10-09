// Duplicate head-to-head: each deal is played twice with partnerships swapped.
// Objective scored: integer points for the hand (make 1, march 2, euchred -2 to
// the makers i.e. +2 to defenders; passed out 0), from A's side.
//
// usage: node lab/euchre/h2h.mjs --a SPEC --b SPEC --deals N [--start K] [--seed S] [--out file.jsonl]
// Chunks with --start/--deals append to --out; summarize with summarize.mjs.
import fs from 'node:fs';
import * as G from '../../public/lab/euchre/engine.js';
import { makeAgent } from './agents.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, x, i, arr) => (x.startsWith('--') ? [...acc, [x.slice(2), arr[i + 1]]] : acc), []),
);
const A = args.a, B = args.b;
const nDeals = Number(args.deals ?? 20), start = Number(args.start ?? 0), seed = Number(args.seed ?? 1);
const out = args.out;

const timing = {};
function timed(name, agent) {
  return {
    act(seat, priv, pub, s) {
      const opts = G.legal(priv, pub);
      if (opts.length === 1) return opts[0];
      const t0 = process.hrtime.bigint();
      const a = agent.act(seat, priv, pub, s);
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      const k = `${name}/${pub.phase === G.PLAY ? 'play' : 'bid'}`;
      const r = (timing[k] ??= { n: 0, ms: 0, max: 0 });
      r.n++; r.ms += dt; r.max = Math.max(r.max, dt);
      if (!opts.includes(a)) throw new Error(`${name} illegal ${a}`);
      return a;
    },
  };
}

export function playHand(agents, deal0, up, dealer, handSeed) {
  let deal = deal0.slice();
  let pub = G.newPublic(dealer, up);
  let step = 0;
  let res;
  while ((res = G.outcome(pub)) === null) {
    const seat = pub.turn;
    const priv = G.privateOf(deal, seat, pub);
    const a = agents[seat].act(seat, priv, pub, G.hash32(handSeed, step++, seat));
    if (G.isHidden(pub)) deal = G.applyHidden(deal, pub, a);
    pub = G.play(pub, a);
  }
  return { pay: res, maker: pub.maker, trump: pub.trump };
}

const agA = timed('A', makeAgent(A)), agB = timed('B', makeAgent(B));
const t0 = Date.now();
for (let i = start; i < start + nDeals; i++) {
  const rng = G.rngFrom(G.hash32(seed, i, 0xdea1));
  const { deal, up } = G.randomDeal(rng);
  const dealer = i & 3;
  const hs = G.hash32(seed, i);
  const r1 = playHand([agA, agB, agA, agB], deal, up, dealer, hs); // A = team 0
  const r2 = playHand([agB, agA, agB, agA], deal, up, dealer, hs); // A = team 1
  const aPts = r1.pay - r2.pay;
  const rec = {
    deal: i, aPts, h1: r1.pay, h2: -r2.pay,
    m1: r1.maker < 0 ? '-' : (r1.maker & 1 ? 'B' : 'A'), m2: r2.maker < 0 ? '-' : (r2.maker & 1 ? 'A' : 'B'),
  };
  if (out) fs.appendFileSync(out, JSON.stringify(rec) + '\n');
}
const secs = (Date.now() - t0) / 1000;
const tline = Object.entries(timing).map(([k, r]) => `${k}: ${r.n} moves, mean ${(r.ms / r.n).toFixed(1)} ms, max ${r.max.toFixed(0)} ms`).join('; ');
console.log(`A=${A} B=${B} deals ${start}..${start + nDeals - 1} seed ${seed}: ${secs.toFixed(1)} s`);
console.log(tline);
if (out) fs.appendFileSync(out.replace(/\.jsonl$/, '.timing.txt'), `deals ${start}..${start + nDeals - 1} ${secs.toFixed(1)} s | ${tline}\n`);
