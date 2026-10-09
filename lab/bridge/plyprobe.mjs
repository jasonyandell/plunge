// How late must a position be for a full-depth taped decision to be affordable?
// Plays a board forward with the rule bot, and at chosen plies times one taped
// Walt decision (full depth unless --cfg overrides). EXPLORATORY tier.
//   node lab/bridge/plyprobe.mjs --board 2 --cfg '{"tape":true,"n":8,"n0":2,"horizon":52}' --plies 44,40,36,32 --budget 60
import { readFileSync } from 'node:fs';
import { Pub, mix, visibleSeats, legalCards, ruleCard } from '../../public/lab/bridge/engine.js';
import { waltDecide, agentOf } from '../../public/lab/bridge/walt.js';

const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const cfg = JSON.parse(arg('cfg', '{"tape":true,"n":8,"n0":2,"horizon":52}'));
const board = Number(arg('board', 2));
const plies = arg('plies', '48,44,40,36,32,28,24,20,16,12,8,4,0').split(',').map(Number).sort((a, b) => b - a);
const budget = Number(arg('budget', 120)) * 1000;
const { deals } = JSON.parse(readFileSync(new URL('./deals-test.json', import.meta.url), 'utf8'));

function parsePBN(pbn) {
  const d = new Uint16Array(16);
  const R = '23456789TJQKA';
  pbn.slice(2).split(' ').forEach((hand, s) => hand.split('.').forEach((cards, k) => {
    const u = 3 - k; for (const ch of cards) d[s * 4 + u] |= 1 << R.indexOf(ch);
  }));
  return d;
}
const D = deals[board];
const deal = parsePBN(D.pbn);
console.log(`board ${board} ${D.contract} dd=${D.dd} cfg=${JSON.stringify(cfg)}`);
let stop = false;
for (const target of plies) {
  if (stop) break;
  const pub = new Pub(D.decl, D.strain, D.level);
  const hand = (s) => [0, 1, 2, 3].map((u) => deal[s * 4 + u] & ~pub.played[u]);
  while (pub.n < target && pub.outcome() < 0) {
    const seat = pub.toMove();
    const h = new Uint16Array(hand(seat));
    const ph = (seat === pub.decl || seat === pub.dummy) ? new Uint16Array(hand((seat + 2) & 3)) : null;
    pub.apply(ruleCard(pub, seat, h, ph));
  }
  if (pub.outcome() >= 0) continue;
  const seat = pub.toMove(), agent = agentOf(pub, seat);
  if (legalCards(new Uint16Array(hand(seat)), pub).length < 2) { console.log(`ply ${pub.n}: forced`); continue; }
  const vis = visibleSeats(agent, pub);
  const known = new Uint16Array(16);
  for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) known[s * 4 + u] = deal[s * 4 + u];
  const t0 = performance.now();
  const r = waltDecide(pub, agent, known, { ...cfg, seed: mix(1, pub.n) });
  const dt = performance.now() - t0;
  const s = r.stats;
  console.log(`ply ${String(pub.n).padStart(2)} (${pub.isDeclSide(seat) ? 'decl' : 'def '}) ${dt.toFixed(0).padStart(8)} ms  nodes ${String(s.nodes).padStart(10)}  minds ${String(s.minds).padStart(8)}  hits ${s.mindHits}  rollouts ${s.rollouts}`);
  if (dt > budget) { console.log('over budget, skipping earlier plies'); stop = true; }
}
