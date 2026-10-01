// Consistency check for engine.sample on states from rule-bot games.
import * as E from '../../public/lab/spades/engine.js';
const rng = E.makeRng(3);
let checked = 0, bad = 0;
for (let g = 0; g < 300; g++) {
  const d = E.dealRandom(rng);
  let p = E.newPublic(g & 3, [3, 3, 3, 3]);
  while (!E.isOver(p)) {
    const seat = E.toMove(p);
    const h = E.privateHand(d, seat, p);
    for (const w of E.sample(seat, h, p, 4, rng)) {
      checked++;
      let all = 0n;
      for (let s = 0; s < 4; s++) {
        const hh = E.privateHand(w, s, p);
        let n = 0;
        for (let su = 0; su < 4; su++) {
          n += E.popcnt(hh[su]);
          if (hh[su] && E.isVoid(p, s, su)) bad++;
          if (w[s * 4 + su] & p[E.P_PLAYED + su]) bad++;
          for (let x = hh[su]; x; x &= x - 1) { const bit = 1n << BigInt(su * 13 + E.loBit(x)); if (all & bit) bad++; all |= bit; }
        }
        if (n !== E.handCount(p, s)) bad++;
        if (s === seat && hh.some((m, i) => m !== h[i])) bad++;
      }
      // actual world must be consistent with the voids too
    }
    p = E.play(p, E.ruleMove(h, p));
  }
}
console.log({ checked, bad });
