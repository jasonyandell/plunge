// Dump random hands (cards, random legal betting line, legal sets, payoff)
// from this engine for oracle_rules.py (OpenSpiel universal_poker replay).
import { Rng } from '../../public/lab/holdem/cards.js';
import * as G from '../../public/lab/holdem/game.js';
const n = +(process.argv[2] || 5000), rng = new Rng(+(process.argv[3] || 11));
for (let i = 0; i < n; i++) {
  const deck = Array.from({ length: 52 }, (_, j) => j);
  for (let k = 0; k < 9; k++) { const j = k + rng.int(52 - k); [deck[k], deck[j]] = [deck[j], deck[k]]; }
  const c = Int8Array.from(deck.slice(0, 9));
  let pub = G.initial();
  const steps = [];
  // bias toward long lines: fold rarely
  while (!pub.done) {
    const o = G.legal(pub);
    let a = o[rng.int(o.length)];
    if (a === G.FOLD && rng.int(6)) a = G.CALL;
    steps.push({ street: pub.street, seat: pub.actor, legal: o, a });
    pub = G.play(pub, a);
  }
  console.log(JSON.stringify({ cards: Array.from(c), steps, pay0: G.payoff(pub, 0, G.showdownSign(c)) }));
}
