// Baseline players and the cheap rollout used beyond Walt's horizon.
// Every policy here reads only (its own hand, the public record, noise).
import {
  CL, DI, SP, HE, FULL, QS, QSBIT, KSBIT, ASBIT, TC, TRICK, NPLAYED, TOMOVE, PUB_LEN,
  legalMasks, legalClasses, randomLegal, applyInPlace, play, isDone, payoff,
  popcount, highBit, lowBit, sampleDeals,
} from './engine.js';

const L = new Int32Array(4);

// ------------------------------------------------------- rule-based bot
// Classic heuristics: lead low from safe suits (flush the Q♠ when that is
// safe), duck under the current winner, take a pointless trick high when
// last, dump Q♠ / A♠ K♠ / high hearts when void.
export function ruleMove(h, off, pub) {
  legalMasks(h, off, pub, L);
  const n = popcount(L[0]) + popcount(L[1]) + popcount(L[2]) + popcount(L[3]);
  if (n === 1) for (let s = 0; s < 4; s++) if (L[s]) return s * 13 + lowBit(L[s]);
  const tc = pub[TC];
  if (tc === 0) return ruleLead(h, off, pub);
  const led = (pub[TRICK] / 13) | 0;
  if (L[led]) return ruleFollow(h, off, pub, led);
  return ruleDiscard(h, off, pub);
}

function outstanding(h, off, pub, s) {
  return FULL & ~pub[s] & ~h[off + s];
}

function ruleLead(h, off, pub) {
  if (pub[NPLAYED] === 0) return 0;
  const qsOut = (outstanding(h, off, pub, SP) & QSBIT) !== 0;
  let best = -1, bestKey = 1e9;
  for (let s = 0; s < 4; s++) {
    const m = L[s];
    if (!m) continue;
    let low = lowBit(m);
    if (s === SP && low === 10 && (m & ~QSBIT)) low = lowBit(m & ~QSBIT & ~((1 << 10) - 1)); // never lead Q♠ by choice
    const out = outstanding(h, off, pub, s);
    let key = 0;
    if (s === SP) {
      if (h[off + SP] & QSBIT) key += 400; // keep spades unled while holding the queen
      else if (qsOut && low > 10) key += 300; // leading A♠/K♠ invites the queen
      else if (qsOut && !(h[off + SP] & (KSBIT | ASBIT))) key -= 15; // flush the queen
    }
    if (s === HE) key += 30;
    if (out === 0) key += 500; // nobody else can follow: they discard onto us
    key += 20 * popcount(out & ((1 << low) - 1)); // outstanding cards that duck under us
    key += popcount(h[off + s]);
    if (key < bestKey) { bestKey = key; best = s * 13 + low; }
  }
  return best;
}

function ruleFollow(h, off, pub, led) {
  const cards = L[led];
  const tc = pub[TC];
  let w = -1, pts = 0;
  for (let i = 0; i < tc; i++) {
    const c = pub[TRICK + i], s = (c / 13) | 0;
    if (s === led && c % 13 > w) w = c % 13;
    if (s === HE) pts++;
    else if (c === QS) pts += 13;
  }
  if (led === SP && cards & QSBIT && w > 10) return QS; // someone is above the queen
  const below = cards & ((1 << w) - 1);
  if (below) return led * 13 + highBit(below); // duck as high as possible
  let m = cards;
  if (led === SP && m & ~QSBIT) m &= ~QSBIT;
  if (tc === 3) return led * 13 + highBit(m); // we take it anyway: shed the highest
  return led * 13 + lowBit(m); // hope to be overtaken
}

function ruleDiscard(h, off, pub) {
  if (L[SP] & QSBIT) return QS;
  const qsOut = (outstanding(h, off, pub, SP) & QSBIT) !== 0;
  if (qsOut && L[SP] & (KSBIT | ASBIT)) return SP * 13 + highBit(L[SP] & (KSBIT | ASBIT));
  if (L[HE]) return HE * 13 + highBit(L[HE]);
  let best = -1, bestKey = -1e9;
  for (let s = 0; s < 3; s++) {
    let m = L[s];
    if (s === SP) m &= ~QSBIT;
    if (!m) continue;
    const hi = highBit(m);
    const key = hi * 20 - popcount(h[off + s]);
    if (key > bestKey) { bestKey = key; best = s * 13 + hi; }
  }
  if (best < 0) for (let s = 0; s < 4; s++) if (L[s]) return s * 13 + highBit(L[s]);
  return best;
}

// ----------------------------------------------------------- rollouts
// Play the hand out from `pub` with every seat on the given policy, reading
// each seat's own cards from `deal`; returns payoff for `me`.
const RH = new Int32Array(16);
const RP = new Array(PUB_LEN).fill(0);
export function rollout(deal, pub, me, policy, rng) {
  for (let i = 0; i < 16; i++) RH[i] = deal[i] & ~pub[i & 3];
  for (let i = 0; i < PUB_LEN; i++) RP[i] = pub[i];
  while (!isDone(RP)) {
    const seat = RP[TOMOVE], off = seat * 4;
    const c = policy === 'rule' ? ruleMove(RH, off, RP) : randomLegal(RH, off, RP, rng);
    RH[off + ((c / 13) | 0)] &= ~(1 << c % 13);
    applyInPlace(RP, c);
  }
  return payoff(RP, me);
}

// ------------------------------------------------------- flat Monte Carlo
// Sample n deals from my chair; score each legal move by playouts of the
// given policy (random = classic flat MC; rule = MC with policy rollouts);
// the same worlds and noise stream for every candidate (CRN).
export function mcMove(seat, hand, pub, rng, n, policy, pins) {
  const opts = legalClasses(hand, 0, pub);
  if (opts.length === 1) return opts[0];
  const deals = sampleDeals(seat, hand, pub, n, rng, pins);
  const base = rng.clone();
  let best = opts[0], bestV = Infinity;
  for (const a of opts) {
    rng.restore(base);
    const p2 = play(pub, a);
    let v = 0;
    for (const d of deals) v += rollout(d, p2, seat, policy, rng);
    if (v < bestV) { bestV = v; best = a; }
  }
  return best;
}

// ------------------------------------------------------------- passing
// Heuristic pass (3 cards): the queen when short in spades, A♠/K♠ when not
// holding enough cover, high hearts, and high cards of short side suits.
export function rulePass(hand) {
  const sp = popcount(hand[SP]);
  const hasQ = (hand[SP] & QSBIT) !== 0;
  const scored = [];
  for (let s = 0; s < 4; s++) {
    let m = hand[s];
    const len = popcount(hand[s]);
    while (m) {
      const r = lowBit(m);
      m &= m - 1;
      let k;
      if (s === SP && r === 10) k = sp >= 5 ? 5 : 100;
      else if (s === SP && r > 10) k = sp >= 5 ? 8 : hasQ ? 90 : 80;
      else if (s === SP) k = 0;
      else if (s === HE) k = 30 + 4 * r;
      else k = 3 * r + (len <= 2 ? 25 : len <= 3 ? 8 : 0);
      if (s === CL && r === 0) k = -1; // the 2♣ leads trick one anyway
      scored.push([k, s * 13 + r]);
    }
  }
  scored.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  return scored.slice(0, 3).map((x) => x[1]);
}

