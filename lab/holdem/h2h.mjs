// Duplicate heads-up limit hold'em match. Each deal (9 cards) is played twice
// with the bots swapping seats (and so swapping both hole cards and position);
// the pair total cancels card luck. Usage:
//   node h2h.mjs <botA> <botB> <deals> [seed] [--track]
// Bot specs: random | station | maniac | equity | exploit | flatmc | walt0 | walt1 | walt1n512 | walt1h0 | walt2h0
import { Rng } from '../../public/lab/holdem/cards.js';
import * as G from '../../public/lab/holdem/game.js';
import * as B from './bots.mjs';
import { LIVE_CFG, LIVE_LEVEL } from '../../public/lab/holdem/config.js';

export const WALT_FAST = { n: 128, horizon: 0, branch: 4, n0: 32, horizon0: 0, branch0: 1 };
export const WALT_L0 = { n: 1024, horizon: 3, branch: 4, n0: 32, horizon0: 0, branch0: 1 };
export function makeBot(spec) {
  switch (spec) {
    case 'random': return B.randomBot;
    case 'station': return B.stationBot;
    case 'maniac': return B.maniacBot;
    case 'equity': return B.equityBot();
    case 'flatmc': return B.flatMcBot();
    case 'exploit': return { ...B.equityBot({ bet: 50, raise: 60, call: 60 }), name: 'exploiter(50/60/60)' };
    case 'walt0': return B.waltBot(0, WALT_L0, 'walt-L0(n1024,full)');
    case 'walt1': return B.waltBot(LIVE_LEVEL, LIVE_CFG, 'walt-L1(live)');
    case 'walt1n512': return B.waltBot(LIVE_LEVEL, { ...LIVE_CFG, n: 512 }, 'walt-L1(live,n512)'); // 4x root deals; all else = live config
    case 'walt1h0': return B.waltBot(1, WALT_FAST, 'walt-L1(street)');
    case 'walt2h0': return B.waltBot(2, { n: 64, horizon: 0, branch: 4, n0: 16, horizon0: 0, branch0: 1 }, 'walt-L2(street)');
    default: throw new Error('unknown bot ' + spec);
  }
}

function dealCards(rng) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 0; i < 9; i++) { const j = i + rng.int(52 - i); const x = deck[i]; deck[i] = deck[j]; deck[j] = x; }
  return Int8Array.from(deck.slice(0, 9));
}

// Play one hand; bots[s] sits in seat s. Returns seat 0's net chips.
export function playHand(cards, bots, rngs, timing, track) {
  const sd = G.showdownSign(cards);
  let pub = G.initial();
  while (!pub.done) {
    const s = pub.actor;
    const view = { seat: s, hole: [cards[2 * s], cards[2 * s + 1]], board: Array.from(cards.subarray(4, 4 + G.BOARD_VISIBLE[pub.street])), pub };
    const t0 = performance.now();
    const a = bots[s].act(view, rngs[s]);
    const dt = performance.now() - t0;
    if (timing) { timing[s].ms += dt; timing[s].n++; timing[s].max = Math.max(timing[s].max, dt); }
    if (track && track.seat === s) track.log(view, a);
    if (!G.legal(pub).includes(a)) throw new Error('illegal action');
    pub = G.play(pub, a);
  }
  return G.payoff(pub, 0, sd);
}

export function runMatch(specA, specB, deals, seed, trackA, from = 0) {
  const A = makeBot(specA), Bb = makeBot(specB);
  const dealRng = new Rng(seed);
  const res = [];
  const tA = { ms: 0, n: 0, max: 0 }, tB = { ms: 0, n: 0, max: 0 };
  for (let i = 0; i < deals; i++) {
    const cards = dealCards(dealRng);
    if (i < from) continue; // chunked runs: deal sequence and per-deal RNGs are index-keyed, so chunks reproduce the full run
    const r1 = [new Rng(seed * 1000003 + i * 4 + 1), new Rng(seed * 1000003 + i * 4 + 2)];
    const r2 = [new Rng(seed * 1000003 + i * 4 + 3), new Rng(seed * 1000003 + i * 4 + 4)];
    const g1 = playHand(cards, [A, Bb], r1, [tA, tB], trackA && { seat: 0, log: trackA });
    const g2 = playHand(cards, [Bb, A], r2, [tB, tA], trackA && { seat: 1, log: trackA });
    res.push(g1 - g2); // A's net over the pair
  }
  return { A: A.name, B: Bb.name, res, tA, tB };
}

export function summarize(m) {
  const n = m.res.length;
  let s = 0; for (const x of m.res) s += x;
  const mean = s / n;
  let v = 0; for (const x of m.res) v += (x - mean) * (x - mean);
  const sd = Math.sqrt(v / (n - 1)), se = sd / Math.sqrt(n);
  const toMbb = (x) => x * 250; // chips per 2 hands -> milli-big-blinds per hand
  const wins = m.res.filter((x) => x > 0).length, losses = m.res.filter((x) => x < 0).length;
  return {
    A: m.A, B: m.B, deals: n, hands: 2 * n, netChipsA: s, pairsWonLostTied: [wins, losses, n - wins - losses],
    mbbPerHand: Math.round(toMbb(mean)), ci95: [Math.round(toMbb(mean - 1.96 * se)), Math.round(toMbb(mean + 1.96 * se))],
    msPerMoveA: +(m.tA.ms / Math.max(1, m.tA.n)).toFixed(1), maxMsA: +m.tA.max.toFixed(0), movesA: m.tA.n,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [a, b, d, sd] = process.argv.slice(2);
  const t0 = Date.now();
  const m = runMatch(a, b, +d, +(sd || 1));
  console.log(JSON.stringify({ ...summarize(m), wallSec: Math.round((Date.now() - t0) / 1000) }));
}
