// Rules conformance vs endplay/DDS (EXPLORATORY tier): play 300 random games in
// the engine (all five strains) and have endplay replay them, checking that every
// card is legal there and every trick goes to the same seat.
//   node lab/bridge/conformance.mjs | $DDS_PYTHON lab/bridge/conformance.py
import { Rng, Pub, randomDeal, contractFor, legalCards, handInto, toPBN } from '../../public/lab/bridge/engine.js';

const rng = new Rng(99), out = [];
for (let g = 0; g < 300; g++) {
  const d = randomDeal(rng), ct = contractFor(d), p = new Pub(ct.decl, g % 5, ct.level), leaders = [];
  const h = new Uint16Array(4);
  while (p.n < 52) {
    handInto(h, d, p.toMove(), p);
    const L = legalCards(h, p);
    p.apply(L[rng.int(L.length)]);
    if (p.tl === 0) leaders.push(p.leader);
  }
  out.push({ pbn: toPBN(d), strain: g % 5, first: (ct.decl + 1) & 3, plays: Array.from(p.plays), leaders });
}
process.stdout.write(JSON.stringify(out));
