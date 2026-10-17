// Cards, a seeded integer PRNG, and an exact 7-card hand evaluator.
// Card c in 0..51: rank = c >> 2 (0 = deuce .. 12 = ace), suit = c & 3.
// No floating point anywhere: scores and random draws are integers.

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const cardRank = (c) => c >> 2;
export const cardSuit = (c) => c & 3;
export const cardName = (c) => RANKS[c >> 2] + SUITS[c & 3];
export function parseCard(s) {
  const r = RANKS.indexOf(s[0].toUpperCase());
  const u = SUITS.indexOf(s[1].toLowerCase());
  if (r < 0 || u < 0) throw new Error('bad card ' + s);
  return (r << 2) | u;
}

// sfc32: small fast counter PRNG, 32-bit integer state.
export class Rng {
  constructor(seed) {
    let s = (seed >>> 0) ^ 0x9e3779b9;
    this.a = 0x243f6a88 ^ s; this.b = 0x85a308d3 ^ (s << 7); this.c = 0x13198a2e ^ (s >>> 3); this.d = 1;
    for (let i = 0; i < 16; i++) this.next();
  }
  next() { // uint32
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t >>> 0;
  }
  int(k) { // uniform in [0, k) by rejection (no modulo bias)
    const lim = 0x100000000 - (0x100000000 % k);
    let x;
    do { x = this.next(); } while (x >= lim);
    return x % k;
  }
}

// Straight top-rank table over 13-bit rank masks (wheel A-5 counts, top = 3).
const STRAIGHT_TOP = new Int8Array(1 << 13).fill(-1);
for (let m = 0; m < (1 << 13); m++) {
  for (let top = 12; top >= 4; top--) {
    const need = 0x1f << (top - 4);
    if ((m & need) === need) { STRAIGHT_TOP[m] = top; break; }
  }
  if (STRAIGHT_TOP[m] < 0 && (m & 0x100f) === 0x100f) STRAIGHT_TOP[m] = 3;
}
// Top-k ranks of a mask, packed 4 bits each (highest first).
function topRanks(mask, k) {
  let v = 0, n = 0;
  for (let r = 12; r >= 0 && n < k; r--) if (mask & (1 << r)) { v = (v << 4) | r; n++; }
  while (n < k) { v <<= 4; n++; }
  return v;
}

// Categories: 8 straight flush, 7 quads, 6 full house, 5 flush, 4 straight,
// 3 trips, 2 two pair, 1 pair, 0 high card. Score = cat << 20 | 5 rank nibbles.
// Higher score = better hand; equal score = tie.
const cnt = new Int8Array(13);
const suitMask = new Int32Array(4);
const suitCnt = new Int8Array(4);
export function evalCards(cards, start, len) {
  cnt.fill(0); suitMask.fill(0); suitCnt.fill(0);
  let all = 0;
  for (let i = start; i < start + len; i++) {
    const c = cards[i], r = c >> 2, s = c & 3;
    cnt[r]++; suitMask[s] |= 1 << r; suitCnt[s]++; all |= 1 << r;
  }
  for (let s = 0; s < 4; s++) {
    if (suitCnt[s] >= 5) {
      const st = STRAIGHT_TOP[suitMask[s]];
      if (st >= 0) return (8 << 20) | (st << 16);
      return (5 << 20) | topRanks(suitMask[s], 5);
    }
  }
  let quad = -1, trips = -1, trips2 = -1, pair1 = -1, pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = cnt[r];
    if (k === 4) quad = r;
    else if (k === 3) { if (trips < 0) trips = r; else if (trips2 < 0) trips2 = r; }
    else if (k === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; }
  }
  if (quad >= 0) return (7 << 20) | (quad << 16) | (topRanks(all & ~(1 << quad), 1) << 12);
  if (trips >= 0) {
    const p = trips2 > pair1 ? trips2 : pair1;
    if (p >= 0) return (6 << 20) | (trips << 16) | (p << 12);
  }
  const st = STRAIGHT_TOP[all];
  if (st >= 0) return (4 << 20) | (st << 16);
  if (trips >= 0) return (3 << 20) | (trips << 16) | (topRanks(all & ~(1 << trips), 2) << 8);
  if (pair2 >= 0) return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (topRanks(all & ~(1 << pair1) & ~(1 << pair2), 1) << 8);
  if (pair1 >= 0) return (1 << 20) | (pair1 << 16) | (topRanks(all & ~(1 << pair1), 3) << 4);
  return topRanks(all, 5);
}
export const handCategory = (score) => score >> 20;
export const CATEGORY_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

const tmp7 = new Int8Array(7);
// Score of hole (2 cards) + board (5 cards).
export function score7(h0, h1, board) {
  tmp7[0] = h0; tmp7[1] = h1;
  for (let i = 0; i < 5; i++) tmp7[2 + i] = board[i];
  return evalCards(tmp7, 0, 7);
}
