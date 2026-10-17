// Dump random deals with this engine's showdown sign, for oracle_check.py.
import { Rng, cardName } from '../../public/lab/holdem/cards.js';
import { showdownSign } from '../../public/lab/holdem/game.js';
const n = +(process.argv[2] || 20000), rng = new Rng(+(process.argv[3] || 5));
for (let i = 0; i < n; i++) {
  const deck = Array.from({ length: 52 }, (_, j) => j);
  for (let k = 0; k < 9; k++) { const j = k + rng.int(52 - k); [deck[k], deck[j]] = [deck[j], deck[k]]; }
  const c = Int8Array.from(deck.slice(0, 9));
  console.log(Array.from(c, cardName).join(' '), showdownSign(c));
}
