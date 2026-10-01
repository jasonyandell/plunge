// Exploratory: Walt's preflop SB action and values for a few holdings.
import { Rng, parseCard } from '../../public/lab/holdem/cards.js';
import * as G from '../../public/lab/holdem/game.js';
import { decide } from '../../public/lab/holdem/walt.js';
const cfg = JSON.parse(process.argv[2]);
const hands = ['AsAh', 'KsQs', '9h9d', 'Ts8s', '7c2d', '5h3c', 'Jd4c', 'QcTd'];
for (const path of ['', 'r', 'c']) {
  let pub = G.initial();
  for (const ch of path) pub = G.play(pub, ch === 'r' ? 2 : 1);
  const seat = G.toMove(pub);
  const out = [];
  for (const h of hands) {
    const hole = [parseCard(h.slice(0, 2)), parseCard(h.slice(2))];
    const acts = [];
    for (let s = 1; s <= 3; s++) {
      const r = decide(G.game, seat, { seat, hole, board: [] }, pub, cfg.level, new Rng(s), cfg);
      acts.push('fcr'[r.action] + '(' + r.values.map((v) => (v / r.n).toFixed(1)).join(',') + ')');
    }
    out.push(h + ' ' + acts.join(' '));
  }
  console.log('after "' + path + '" seat', seat, '\n  ' + out.join('\n  '));
}
