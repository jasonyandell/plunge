// ms/move distribution of the live Walt over random reachable decision points
// (random legal lines, random deals). Usage: node timing.mjs [count] [seed]
import { Rng } from '../../public/lab/holdem/cards.js';
import * as G from '../../public/lab/holdem/game.js';
import { decide } from '../../public/lab/holdem/walt.js';
import { LIVE_CFG, LIVE_LEVEL } from '../../public/lab/holdem/config.js';
const count = +(process.argv[2] || 200), rng = new Rng(+(process.argv[3] || 3));
const by = [[], [], [], []], all = [];
let worst = null;
for (let i = 0; i < count; i++) {
  const deck = Array.from({ length: 52 }, (_, j) => j);
  for (let k = 0; k < 9; k++) { const j = k + rng.int(52 - k); [deck[k], deck[j]] = [deck[j], deck[k]]; }
  const c = Int8Array.from(deck.slice(0, 9));
  let pub = G.initial();
  const stopAt = rng.int(12);
  for (let s = 0; s < stopAt; s++) { const o = G.legal(pub).filter((a) => a !== G.FOLD); const nx = G.play(pub, o[rng.int(o.length)]); if (nx.done) break; pub = nx; }
  const seat = pub.actor;
  const t0 = performance.now();
  decide(G.game, seat, { seat, hole: [c[2 * seat], c[2 * seat + 1]], board: Array.from(c.subarray(4, 4 + G.BOARD_VISIBLE[pub.street])) }, pub, LIVE_LEVEL, new Rng(i), LIVE_CFG);
  const ms = performance.now() - t0;
  by[pub.street].push(ms); all.push(ms);
  if (!worst || ms > worst.ms) worst = { ms: Math.round(ms), hist: pub.hist };
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : '-'; };
for (let s = 0; s < 4; s++) console.log(['preflop', 'flop', 'turn', 'river'][s].padEnd(8), 'n', by[s].length, 'median', pct(by[s], 0.5), 'p90', pct(by[s], 0.9), 'max', pct(by[s], 1));
console.log('all     n', all.length, 'median', pct(all, 0.5), 'p90', pct(all, 0.9), 'max', pct(all, 1), 'worst line', JSON.stringify(worst));
