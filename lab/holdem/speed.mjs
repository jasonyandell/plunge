import { Rng } from '../../public/lab/holdem/cards.js';
import * as G from '../../public/lab/holdem/game.js';
import { decide } from '../../public/lab/holdem/walt.js';
const cfgs = JSON.parse(process.argv[2] || '[]');
const rng = new Rng(7);
for (const cfg of cfgs) {
  for (const street of [0, 1, 2, 3]) {
    let tot = 0, cnt = 0, minds = 0;
    for (let t = 0; t < 6; t++) {
      // build a public state at the given street via check/call lines
      let pub = G.initial();
      while (pub.street < street) pub = G.play(pub, G.CALL);
      const deck = Array.from({ length: 52 }, (_, i) => i);
      for (let i = 51; i > 0; i--) { const j = rng.int(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      const deal = Int8Array.from(deck.slice(0, 9));
      const seat = G.toMove(pub);
      const priv = G.privateOf({ c: deal }, seat, pub);
      const t0 = performance.now();
      const r = decide(G.game, seat, priv, pub, cfg.level, new Rng(t), cfg);
      tot += performance.now() - t0; cnt++; minds += r.stats.minds;
    }
    console.log(JSON.stringify(cfg), 'street', street, 'ms', (tot / cnt).toFixed(1), 'minds', (minds / cnt) | 0);
  }
}
