// Chunked duplicate match with the behavior table, for runs too long for one 10-minute call.
// Usage: node chunk_n512.mjs <A> <B> <from> <to> [seed]  -> one JSON line (raw per-deal results + table + timing)
// Merge chunks with: node merge_n512.mjs <file.jsonl>
import { Rng } from '../../public/lab/holdem/cards.js';
import * as G from '../../public/lab/holdem/game.js';
import { equity2 } from './bots.mjs';
import { runMatch } from './h2h.mjs';
const [a, b, f, t, sd] = process.argv.slice(2);
const erng = new Rng(99), tab = {};
const t0 = Date.now();
const m = runMatch(a, b, +t, +(sd || 1), (view, act) => {
  const [g, tt] = equity2(view.hole, view.board, 400, erng);
  const bucket = Math.min(4, Math.floor((g * 5) / tt));
  const facing = G.legal(view.pub).includes(G.FOLD) ? 'facing' : 'open';
  const key = ['pre', 'flop', 'turn', 'river'][view.pub.street] + '/' + facing;
  tab[key] = tab[key] || Array.from({ length: 5 }, () => [0, 0, 0]);
  tab[key][bucket][act]++;
}, +f);
console.log(JSON.stringify({ A: m.A, B: m.B, from: +f, to: +t, seed: +(sd || 1), res: m.res, tab, tA: m.tA, wallSec: Math.round((Date.now() - t0) / 1000) }));
