// ms/move benchmark: replay rule-bot hands, time SPEC's decision at every
// non-forced decision point (bidding/discard vs card play separately).
// usage: node lab/euchre/bench.mjs SPEC [hands] [seed]
import * as G from '../../public/lab/euchre/engine.js';
import { makeRule } from '../../public/lab/euchre/bots.js';
import { makeAgent } from './agents.mjs';

const spec = process.argv[2] ?? 'walt:level=1,n=24,n0=8';
const hands = Number(process.argv[3] ?? 6), seed = Number(process.argv[4] ?? 3);
const ag = makeAgent(spec), rule = makeRule();
const t = { bid: [], play: [] };
for (let h = 0; h < hands; h++) {
  const rng = G.rngFrom(G.hash32(seed, h));
  const { deal: d0, up } = G.randomDeal(rng);
  let deal = d0.slice(), pub = G.newPublic(h & 3, up), step = 0;
  while (G.outcome(pub) === null) {
    const seat = pub.turn, priv = G.privateOf(deal, seat, pub);
    if (G.legal(priv, pub).length > 1) {
      const t0 = process.hrtime.bigint();
      ag.act(seat, priv, pub, G.hash32(seed, h, step));
      t[pub.phase === G.PLAY ? 'play' : 'bid'].push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    step++;
    const a = rule.act(seat, priv, pub);
    if (G.isHidden(pub)) deal = G.applyHidden(deal, pub, a);
    pub = G.play(pub, a);
  }
}
for (const k of ['bid', 'play']) {
  const xs = t[k].sort((a, b) => a - b);
  if (!xs.length) continue;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`${spec} ${k}: ${xs.length} decisions, mean ${mean.toFixed(1)} ms, median ${xs[xs.length >> 1].toFixed(1)}, p90 ${xs[Math.floor(xs.length * 0.9)].toFixed(1)}, max ${xs[xs.length - 1].toFixed(1)} ms`);
}
