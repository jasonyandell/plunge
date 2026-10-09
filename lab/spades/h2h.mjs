// Duplicate head-to-head for spades card play.
//
//   node lab/spades/h2h.mjs A B --seed S --from i --to j --out file.jsonl
//
// A, B: player specs, e.g. walt | walt:n=24,n0=4,horizon=8 | rule | random |
//       flatmc:n=64 | pimc:n=16,depthTricks=2,exactTricks=6
// Deal i (fixed by seed) is played twice: table 1 with A as North/South and B
// as East/West, table 2 with the partnerships swapped. Every seat bids with the
// shared heuristic bidder, so contracts are identical at both tables and only
// card play differs. One JSON line per deal is appended to --out; run
// summarize.mjs on the file(s) for the table.

import fs from 'node:fs';
import * as E from '../../public/lab/spades/engine.js';
import { waltMove } from '../../public/lab/spades/walt.js';
import { randomPlayer, rulePlayer, flatMcPlayer, pimcPlayer } from './baselines.js';

function parseSpec(spec) {
  const [kind, rest] = spec.split(':');
  const cfg = {};
  if (rest)
    for (const kv of rest.split(',')) {
      const [k, v] = kv.split('=');
      cfg[k] = /^\d+$/.test(v) ? parseInt(v, 10) : v;
    }
  return { kind, cfg };
}

function makePlayer({ kind, cfg }, seed, timing) {
  let f;
  if (kind === 'walt') f = (h, p, seat) => waltMove(seat, h, p, cfg, E.mix(seed, p[E.P_NTRICKS] * 4 + p[E.P_TLEN] + 64 * seat)).card;
  else if (kind === 'rule') f = rulePlayer();
  else if (kind === 'random') f = randomPlayer(seed);
  else if (kind === 'flatmc') f = flatMcPlayer(cfg, seed);
  else if (kind === 'pimc') f = pimcPlayer(cfg, seed);
  else throw new Error('unknown player ' + kind);
  return (h, p, seat) => {
    const t = process.hrtime.bigint();
    const c = f(h, p, seat);
    timing.ns += process.hrtime.bigint() - t;
    timing.moves++;
    return c;
  };
}

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const A = parseSpec(args[0]), B = parseSpec(args[1]);
const seed = parseInt(opt('seed', '1'), 10);
const from = parseInt(opt('from', '0'), 10), to = parseInt(opt('to', '10'), 10);
const out = opt('out', null);

for (let i = from; i < to; i++) {
  const deal = E.dealRandom(E.makeRng(E.mix(seed, i)));
  const dealer = i & 3;
  const res = {};
  for (const table of [1, 2]) {
    const tA = { ns: 0n, moves: 0 }, tB = { ns: 0n, moves: 0 };
    const nA = E.mix(E.mix(seed ^ 0x5eed, i), table), nB = E.mix(E.mix(seed ^ 0xb0b, i), table);
    const pa = makePlayer(A, nA, tA), pb = makePlayer(B, nB, tB);
    // table 1: A = seats 0,2 (team 0); table 2: A = seats 1,3 (team 1)
    const players = table === 1 ? [pa, pb, pa, pb] : [pb, pa, pb, pa];
    const r = E.playHand(deal, dealer, players);
    const aTeam = table === 1 ? 0 : 1;
    const pay0 = E.payoff(r.pub);
    res['t' + table] = {
      a: aTeam === 0 ? pay0 : -pay0, // A's zero-sum payoff at this table
      aTricks: r.pub[E.P_WON + aTeam],
      aBid: E.teamBid(r.pub, aTeam),
      bTricks: r.pub[E.P_WON + (aTeam ^ 1)],
      bBid: E.teamBid(r.pub, aTeam ^ 1),
      msA: Number(tA.ns / 1000n) / 1000 / Math.max(1, tA.moves),
      msB: Number(tB.ns / 1000n) / 1000 / Math.max(1, tB.moves),
    };
  }
  const line = { deal: i, seed, A: args[0], B: args[1], ...res, diff: res.t1.a + res.t2.a };
  if (out) fs.appendFileSync(out, JSON.stringify(line) + '\n');
  console.log(i, 'A payoff t1', res.t1.a, 't2', res.t2.a, 'dup', line.diff);
}
