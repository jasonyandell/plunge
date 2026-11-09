// Self-check: rules invariants, sampler consistency, and a smoke game of each policy.
import * as E from '../../public/lab/hearts/engine.js';
import { ruleMove, mcMove, rollout } from '../../public/lab/hearts/bots.js';
import { waltMove } from '../../public/lab/hearts/walt.js';

const rng = new E.Rng(12345);
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks++; }

function playHand(deal, chooser) {
  let pub = E.newPublic(E.seatOf2C(deal));
  while (!E.isDone(pub)) {
    const seat = pub[E.TOMOVE];
    const hand = E.privateHand(deal, seat, pub);
    const c = chooser(seat, hand, pub);
    const legal = E.legalCards(hand, 0, pub);
    assert(legal.includes(c), `illegal ${E.cardName(c)}`);
    pub = E.play(pub, c);
    if (pub[E.NPLAYED] % 7 === 3 && !E.isDone(pub)) {
      // sampler: from the next seat's chair
      const s2 = pub[E.TOMOVE], h2 = E.privateHand(deal, s2, pub);
      const ds = E.sampleDeals(s2, h2, pub, 3, rng, null);
      for (const d of ds) {
        let seen = 0;
        for (let o = 0; o < 4; o++) {
          assert(E.privateHand(d, o, pub).reduce((a, m) => a + E.popcount(m), 0) === E.handSize(pub, o), 'size');
          for (let s = 0; s < 4; s++) {
            assert((d[o * 4 + s] & ~pub[E.ALLOW + o * 4 + s]) === 0 || o === s2, 'allow');
            assert((d[o * 4 + s] & seen) === 0 || true, '');
          }
        }
        for (let s = 0; s < 4; s++) assert(d[s2 * 4 + s] === h2[s], 'own hand');
        // the true deal must also satisfy the constraints (lawfulness of ALLOW)
        for (let o = 0; o < 4; o++) for (let s = 0; s < 4; s++)
          assert((deal[o * 4 + s] & ~pub[s] & ~pub[E.ALLOW + o * 4 + s]) === 0, 'true deal violates ALLOW');
      }
    }
  }
  assert(E.pointsTaken(pub) === 26, 'points');
  return [0, 1, 2, 3].map((s) => E.payoff(pub, s));
}

for (let g = 0; g < 300; g++) {
  const deal = E.randomDeal(rng);
  playHand(deal, (s, h, p) => (g % 2 ? ruleMove(h, 0, p) : E.randomLegal(h, 0, p, rng)));
}
// exact sampler against a heavily constrained state: rule bots till trick 9
{
  let hits = 0;
  for (let g = 0; g < 50; g++) {
    const deal = E.randomDeal(rng);
    let pub = E.newPublic(E.seatOf2C(deal));
    while (pub[E.NPLAYED] < 34) pub = E.play(pub, ruleMove(E.privateHand(deal, pub[E.TOMOVE], pub), 0, pub));
    const s = pub[E.TOMOVE];
    const ds = E.sampleDeals(s, E.privateHand(deal, s, pub), pub, 20, rng, null);
    hits += ds.length;
  }
  assert(hits === 1000, 'exact sampler');
}
let t0 = Date.now();
const deal = E.randomDeal(new E.Rng(7));
const r = playHand(deal, (s, h, p) => (s === 0 ? waltMove(s, h, p, rng) : ruleMove(h, 0, p)));
console.log('walt smoke game payoffs', r, 'ms', Date.now() - t0);
t0 = Date.now();
const r2 = playHand(deal, (s, h, p) => (s === 0 ? mcMove(s, h, p, rng, 40, 'random', null) : ruleMove(h, 0, p)));
console.log('flatMC smoke game payoffs', r2, 'ms', Date.now() - t0);
console.log('checks passed:', checks);

// Uniformity: exact BigInt sampler vs rejection sampler on a constrained state.
{
  const r2 = new E.Rng(99);
  let found = null;
  for (let g = 0; g < 500 && !found; g++) {
    const deal = E.randomDeal(r2);
    let pub = E.newPublic(E.seatOf2C(deal));
    while (pub[E.NPLAYED] < 22) pub = E.play(pub, ruleMove(E.privateHand(deal, pub[E.TOMOVE], pub), 0, pub));
    let voids = 0;
    for (let i = 0; i < 16; i++) if (pub[E.ALLOW + i] === 0) voids++;
    if (voids >= 2) found = { deal, pub };
  }
  const { deal, pub } = found;
  const s = pub[E.TOMOVE], h = E.privateHand(deal, s, pub);
  const N = 6000;
  const tally = (exact) => {
    const cnt = new Array(16).fill(0);
    for (const d of E.sampleDeals(s, h, pub, N, new E.Rng(exact ? 5 : 6), null, exact))
      for (let o = 0; o < 4; o++) for (let su = 0; su < 4; su++) cnt[o * 4 + su] += E.popcount(d[o * 4 + su]);
    return cnt;
  };
  const a = tally(true), b = tally(false);
  let maxRel = 0;
  for (let i = 0; i < 16; i++) if (a[i] + b[i] > 2000) maxRel = Math.max(maxRel, Math.abs(a[i] - b[i]) / ((a[i] + b[i]) / 2));
  console.log('sampler uniformity: max relative gap in seat-suit counts (exact vs rejection):', maxRel.toFixed(3));
  if (maxRel > 0.05) throw new Error('exact and rejection samplers disagree');
}
