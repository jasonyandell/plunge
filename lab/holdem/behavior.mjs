// Exploratory probe: how a bot's actions depend on hand strength. Buckets by
// equity vs a random hand (river exact, earlier streets Monte Carlo 400).
// Usage: node behavior.mjs <bot> <opponent> <deals> [seed]
import { Rng } from '../../public/lab/holdem/cards.js';
import * as G from '../../public/lab/holdem/game.js';
import { equity2 } from './bots.mjs';
import { runMatch, summarize } from './h2h.mjs';
const [a, b, d, sd] = process.argv.slice(2);
const erng = new Rng(99);
const tab = {}; // street|facing -> bucket -> [fold, call, raise]
const m = runMatch(a, b, +d, +(sd || 1), (view, act) => {
  const [g, t] = equity2(view.hole, view.board, 400, erng);
  const bucket = Math.min(4, Math.floor((g * 5) / t)); // quintiles of equity
  const facing = G.legal(view.pub).includes(G.FOLD) ? 'facing' : 'open';
  const key = ['pre', 'flop', 'turn', 'river'][view.pub.street] + '/' + facing;
  tab[key] = tab[key] || Array.from({ length: 5 }, () => [0, 0, 0]);
  tab[key][bucket][act]++;
});
console.log(JSON.stringify(summarize(m)));
console.log('rows: street/situation; cols: equity-vs-random quintile 0-20%..80-100%; cell f/c/r counts (open: c = check, r = bet)');
for (const k of Object.keys(tab).sort()) console.log(k.padEnd(13), tab[k].map((x) => x.join('/').padStart(10)).join(' '));
