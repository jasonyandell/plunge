// Hearts engine: rules, public state, lawful deal sampler, RNG.
// Shared verbatim by the browser worker and the Node h2h harness.
//
// Cards: c = suit*13 + rank, rank 0..12 = 2..A; suits 0 ♣, 1 ♦, 2 ♠, 3 ♥.
// A hand is 4 suit masks (13 bits each). Seats 0..3 play clockwise
// (0 South, 1 West, 2 North, 3 East); seat+1 is the next to play.
//
// Public state is a plain int array (immutable in the search: play() copies).
// It holds only what every seat has seen: the cards played, the current
// trick, points taken, hearts broken, and the lawful hand constraints those
// plays reveal (voids; "only hearts" from an unbroken heart lead; "only point
// cards" from a point discard on trick 1).

export const CL = 0, DI = 1, SP = 2, HE = 3;
export const FULL = 0x1fff;
export const QS = 2 * 13 + 10; // queen of spades
export const QSBIT = 1 << 10;
export const KSBIT = 1 << 11;
export const ASBIT = 1 << 12;
export const SUIT_SYM = ['♣', '♦', '♠', '♥'];
export const RANK_SYM = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Public layout
export const LEADER = 4, TOMOVE = 5, NPLAYED = 6, TC = 7, TRICK = 8, PTS = 12, BROKEN = 16, ALLOW = 17;
export const PUB_LEN = 33;

export function cardName(c) {
  return RANK_SYM[c % 13] + SUIT_SYM[(c / 13) | 0];
}

export function popcount(m) {
  m = m - ((m >>> 1) & 0x55555555);
  m = (m & 0x33333333) + ((m >>> 2) & 0x33333333);
  return (((m + (m >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
export function highBit(m) {
  return 31 - Math.clz32(m);
}
export function lowBit(m) {
  return 31 - Math.clz32(m & -m);
}

export function newPublic(leader) {
  const p = new Array(PUB_LEN).fill(0);
  p[LEADER] = leader;
  p[TOMOVE] = leader;
  for (let i = 0; i < 16; i++) p[ALLOW + i] = FULL;
  return p;
}

export function seatOf2C(deal) {
  for (let s = 0; s < 4; s++) if (deal[s * 4 + CL] & 1) return s;
  return -1;
}

// Cards held now by `seat` (the deal minus what has been played).
export function privateHand(deal, seat, pub) {
  const o = seat * 4;
  return [deal[o] & ~pub[0], deal[o + 1] & ~pub[1], deal[o + 2] & ~pub[2], deal[o + 3] & ~pub[3]];
}

// Legal cards as 4 suit masks, written to out. h is read at offset off.
export function legalMasks(h, off, pub, out) {
  const tc = pub[TC];
  const h0 = h[off], h1 = h[off + 1], h2 = h[off + 2], h3 = h[off + 3];
  if (tc === 0) {
    if (pub[NPLAYED] === 0) {
      out[0] = h0 & 1; out[1] = 0; out[2] = 0; out[3] = 0;
      return;
    }
    out[0] = h0; out[1] = h1; out[2] = h2;
    out[3] = !pub[BROKEN] && (h0 | h1 | h2) ? 0 : h3;
    return;
  }
  const led = (pub[TRICK] / 13) | 0;
  const hl = h[off + led];
  if (hl) {
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
    out[led] = hl;
    return;
  }
  out[0] = h0; out[1] = h1; out[2] = h2; out[3] = h3;
  if (pub[NPLAYED] < 4 && (h0 | h1 | (h2 & ~QSBIT))) {
    // first trick: no points unless the hand holds nothing else
    out[3] = 0;
    out[2] = h2 & ~QSBIT;
  }
}

const _L = new Int32Array(4);

export function legalCards(h, off, pub) {
  legalMasks(h, off, pub, _L);
  const r = [];
  for (let s = 0; s < 4; s++) {
    let m = _L[s];
    while (m) {
      const b = lowBit(m);
      m &= m - 1;
      r.push(s * 13 + b);
    }
  }
  return r;
}

// Legal cards reduced to equivalence classes (lowest card of each run).
// Two legal cards of one suit are equivalent when every rank between them
// left the game in a completed trick, and neither is the Q♠ (which carries
// its own points). Reads only the hand and the public record.
export function legalClasses(h, off, pub) {
  legalMasks(h, off, pub, _L);
  const r = [];
  for (let s = 0; s < 4; s++) {
    let m = _L[s];
    if (!m) continue;
    let gone = pub[s];
    for (let i = 0; i < pub[TC]; i++) {
      const c = pub[TRICK + i];
      if (((c / 13) | 0) === s) gone &= ~(1 << (c % 13));
    }
    let prev = -1;
    while (m) {
      const b = lowBit(m);
      m &= m - 1;
      let same = false;
      if (prev >= 0) {
        const between = ((1 << b) - 1) & ~((1 << (prev + 1)) - 1);
        same = (between & ~gone) === 0 && !(s === SP && (b === 10 || prev === 10));
      }
      if (!same) r.push(s * 13 + b);
      prev = b;
    }
  }
  return r;
}

export function countLegal(h, off, pub) {
  legalMasks(h, off, pub, _L);
  return popcount(_L[0]) + popcount(_L[1]) + popcount(_L[2]) + popcount(_L[3]);
}

export function randomLegal(h, off, pub, rng) {
  legalMasks(h, off, pub, _L);
  const n = popcount(_L[0]) + popcount(_L[1]) + popcount(_L[2]) + popcount(_L[3]);
  let k = rng.below(n);
  for (let s = 0; s < 4; s++) {
    let m = _L[s];
    const c = popcount(m);
    if (k >= c) { k -= c; continue; }
    while (k-- > 0) m &= m - 1;
    return s * 13 + lowBit(m);
  }
  return -1;
}

// Apply a card in place (used by rollouts and by play()).
export function applyInPlace(p, c) {
  const s = (c / 13) | 0, r = c - 13 * s;
  const seat = p[TOMOVE], tc = p[TC];
  const a = ALLOW + seat * 4;
  if (tc === 0) {
    if (s === HE && !p[BROKEN]) { p[a] = 0; p[a + 1] = 0; p[a + 2] = 0; }
  } else {
    const led = (p[TRICK] / 13) | 0;
    if (s !== led) {
      p[a + led] = 0;
      if (p[NPLAYED] < 4 && (s === HE || c === QS)) {
        p[a + CL] = 0; p[a + DI] = 0; p[a + SP] &= QSBIT;
      }
    }
  }
  if (s === HE) p[BROKEN] = 1;
  p[s] |= 1 << r;
  p[TRICK + tc] = c;
  p[NPLAYED]++;
  if (tc === 3) {
    const led = (p[TRICK] / 13) | 0;
    let bi = 0, br = p[TRICK] % 13, pts = 0;
    for (let i = 0; i < 4; i++) {
      const x = p[TRICK + i], xs = (x / 13) | 0;
      if (xs === HE) pts++;
      else if (x === QS) pts += 13;
      if (xs === led && x % 13 > br) { br = x % 13; bi = i; }
    }
    const w = (p[LEADER] + bi) & 3;
    p[PTS + w] += pts;
    p[TC] = 0;
    p[LEADER] = w;
    p[TOMOVE] = w;
  } else {
    p[TC] = tc + 1;
    p[TOMOVE] = (seat + 1) & 3;
  }
}

export function play(p, c) {
  const q = p.slice();
  applyInPlace(q, c);
  return q;
}

export function pointsTaken(p) {
  return p[PTS] + p[PTS + 1] + p[PTS + 2] + p[PTS + 3];
}

// The hand is decided once every point card sits in a completed trick.
export function isDone(p) {
  return p[TC] === 0 && pointsTaken(p) === 26;
}

// Hand score for `seat` (lower is better). Shoot the moon: the taker of all
// 26 scores 0 and every other seat scores 26.
export function payoff(p, seat) {
  for (let s = 0; s < 4; s++) if (p[PTS + s] === 26) return s === seat ? 0 : 26;
  return p[PTS + seat];
}

// Lower bound on payoff(seat) over every continuation (public, deal-free).
export function payoffLowerBound(p, seat) {
  let holders = 0;
  for (let s = 0; s < 4; s++) if (p[PTS + s] > 0) holders++;
  return holders >= 2 ? p[PTS + seat] : 0;
}

export function handSize(p, seat) {
  const done = (p[NPLAYED] - p[TC]) >> 2;
  const pos = (seat - p[LEADER] + 4) & 3;
  return 13 - done - (pos < p[TC] ? 1 : 0);
}

// ---------------------------------------------------------------- RNG
// sfc32: integer-only generator; next() returns a uint32.
export class Rng {
  constructor(seed) {
    this.a = 0x9e3779b9; this.b = 0x243f6a88; this.c = 0xb7e15162; this.d = seed >>> 0;
    for (let i = 0; i < 15; i++) this.next();
  }
  next() {
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
  below(n) {
    if (n <= 1) return 0;
    const lim = 4294967296 - (4294967296 % n);
    let x;
    do x = this.next(); while (x >= lim);
    return x % n;
  }
  clone() {
    const r = Object.create(Rng.prototype);
    r.a = this.a; r.b = this.b; r.c = this.c; r.d = this.d;
    return r;
  }
  restore(o) {
    this.a = o.a; this.b = o.b; this.c = o.c; this.d = o.d;
  }
}

export function mixSeed(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= x >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
  }
  return h >>> 0;
}

// A fresh uniformly random deal: Int32Array(16) of suit masks per seat.
export function randomDeal(rng) {
  const cards = [];
  for (let c = 0; c < 52; c++) cards.push(c);
  for (let i = 51; i > 0; i--) {
    const j = rng.below(i + 1);
    const t = cards[i]; cards[i] = cards[j]; cards[j] = t;
  }
  const d = new Int32Array(16);
  for (let i = 0; i < 52; i++) {
    const c = cards[i], seat = (i / 13) | 0;
    d[seat * 4 + ((c / 13) | 0)] |= 1 << c % 13;
  }
  return d;
}

// ------------------------------------------------------------- sampler
// n deals consistent with what `seat` can see: its own hand, the public
// record (hand sizes, lawful constraints in ALLOW), and `pins` (cards this
// seat knows the location of -- the cards it passed; Int32Array(16) or null).
// Exactly uniform over consistent deals: rejection while it is cheap,
// otherwise an exact integer (BigInt) count-and-draw over constraint classes.
// Each deal holds the current (unplayed) hands, Int32Array(16).

const BINOM = [];
for (let n = 0; n <= 52; n++) {
  BINOM.push([]);
  for (let k = 0; k <= n; k++) BINOM[n].push(k === 0 || k === n ? 1n : BINOM[n - 1][k - 1] + BINOM[n - 1][k]);
}

function randBigBelow(total, rng) {
  let bits = total.toString(2).length + 64;
  let x = 0n;
  while (bits > 0) { x = (x << 32n) | BigInt(rng.next()); bits -= 32; }
  return x % total;
}

export function sampleDeals(seat, hand, pub, n, rng, pins, forceExact = false) {
  const others = [];
  for (let s = 1; s < 4; s++) others.push((seat + s) & 3);
  const base = new Int32Array(16);
  const unk = new Int32Array(4);
  for (let s = 0; s < 4; s++) {
    base[seat * 4 + s] = hand[s];
    unk[s] = FULL & ~pub[s] & ~hand[s];
  }
  const need = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const o = others[i];
    let pinned = 0;
    if (pins) {
      for (let s = 0; s < 4; s++) {
        const m = pins[o * 4 + s] & unk[s];
        base[o * 4 + s] |= m;
        pinned += popcount(m);
      }
    }
    need[i] = handSize(pub, o) - pinned;
  }
  // cards pinned into other seats are no longer unknown
  for (const o of others) for (let s = 0; s < 4; s++) unk[s] &= ~base[o * 4 + s];
  const cards = [];
  for (let s = 0; s < 4; s++) {
    let m = unk[s];
    while (m) { const b = lowBit(m); m &= m - 1; cards.push(s * 13 + b); }
  }
  // forbidden masks per other seat (cards it cannot hold)
  const forb = others.map((o) => {
    const f = new Int32Array(4);
    let any = 0;
    for (let s = 0; s < 4; s++) { f[s] = unk[s] & ~pub[ALLOW + o * 4 + s]; any |= f[s]; }
    f.any = any;
    return f;
  });
  const constrained = forb.some((f) => f.any);
  const out = [];
  let useExact = forceExact;
  let exact = null;
  for (let k = 0; k < n; k++) {
    let d = null;
    if (!useExact) {
      for (let t = 0; t < (constrained ? 40 : 1) && !d; t++) d = tryShuffle(cards, need, others, base, forb, rng, constrained);
      if (!d) useExact = true;
    }
    if (useExact) {
      if (!exact) exact = buildExact(cards, need, others, pub);
      d = drawExact(exact, need, others, base, rng);
    }
    out.push(d);
  }
  return out;
}

function tryShuffle(cards, need, others, base, forb, rng, constrained) {
  const a = cards.slice();
  const n = a.length;
  for (let i = n - 1; i > 0; i--) {
    const j = rng.below(i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  const d = base.slice();
  let i = 0;
  for (let k = 0; k < 3; k++) {
    const o = others[k], f = forb[k];
    for (let j = 0; j < need[k]; j++, i++) {
      const c = a[i], s = (c / 13) | 0, bit = 1 << c % 13;
      if (constrained && f[s] & bit) return null;
      d[o * 4 + s] |= bit;
    }
  }
  return d;
}

function buildExact(cards, need, others, pub) {
  // group unknown cards by the set of other seats allowed to hold them
  const byKey = new Map();
  for (const c of cards) {
    const s = (c / 13) | 0, bit = 1 << c % 13;
    let key = 0;
    for (let k = 0; k < 3; k++) if (pub[ALLOW + others[k] * 4 + s] & bit) key |= 1 << k;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }
  const classes = [...byKey.entries()].map(([key, cs]) => ({ key, cards: cs }));
  const W0 = need[0] + 1, W1 = need[1] + 1;
  // f[i][r0*W1+r1] = ways to place classes i.. with r0, r1 slots left in seats 0, 1
  const f = [];
  const suffix = [];
  let acc = 0;
  for (let i = classes.length; i >= 0; i--) { suffix[i] = acc; if (i > 0) acc += classes[i - 1].cards.length; }
  f[classes.length] = new Array(W0 * W1).fill(0n);
  f[classes.length][0] = 1n;
  for (let i = classes.length - 1; i >= 0; i--) {
    const m = classes[i].cards.length, key = classes[i].key, rest = suffix[i];
    const row = new Array(W0 * W1).fill(0n);
    for (let r0 = 0; r0 < W0; r0++) for (let r1 = 0; r1 < W1; r1++) {
      const r2 = rest - r0 - r1;
      if (r2 < 0 || r2 > need[2]) continue;
      let sum = 0n;
      for (let x0 = 0; x0 <= Math.min(m, r0); x0++) {
        if (x0 && !(key & 1)) break;
        for (let x1 = 0; x1 <= Math.min(m - x0, r1); x1++) {
          if (x1 && !(key & 2)) break;
          const x2 = m - x0 - x1;
          if (x2 > r2 || (x2 && !(key & 4))) continue;
          const nx = f[i + 1][(r0 - x0) * W1 + (r1 - x1)];
          if (nx) sum += BINOM[m][x0] * BINOM[m - x0][x1] * nx;
        }
      }
      row[r0 * W1 + r1] = sum;
    }
    f[i] = row;
  }
  return { classes, f, W1 };
}

function drawExact(ex, need, others, base, rng) {
  const { classes, f, W1 } = ex;
  let r0 = need[0], r1 = need[1];
  const total = f[0][r0 * W1 + r1];
  if (total === 0n) throw new Error('no deal consistent with the public record');
  let R = randBigBelow(total, rng);
  const d = base.slice();
  for (let i = 0; i < classes.length; i++) {
    const { key, cards } = classes[i];
    const m = cards.length;
    let pick = null;
    outer: for (let x0 = 0; x0 <= Math.min(m, r0); x0++) {
      if (x0 && !(key & 1)) break;
      for (let x1 = 0; x1 <= Math.min(m - x0, r1); x1++) {
        if (x1 && !(key & 2)) break;
        const x2 = m - x0 - x1;
        if (x2 && !(key & 4)) continue;
        const nx = f[i + 1][(r0 - x0) * W1 + (r1 - x1)];
        if (!nx) continue;
        const w = BINOM[m][x0] * BINOM[m - x0][x1] * nx;
        if (R < w) { pick = [x0, x1, x2]; R %= nx; break outer; }
        R -= w;
      }
    }
    // R now indexes the remaining classes uniformly (R mod nx); which cards
    // of this class go where is a fresh uniform permutation
    const a = cards.slice();
    for (let j = a.length - 1; j > 0; j--) {
      const k = rng.below(j + 1);
      const t = a[j]; a[j] = a[k]; a[k] = t;
    }
    let j = 0;
    for (let k = 0; k < 3; k++) for (let t = 0; t < pick[k]; t++, j++) {
      const c = a[j];
      d[others[k] * 4 + ((c / 13) | 0)] |= 1 << c % 13;
    }
    r0 -= pick[0]; r1 -= pick[1];
  }
  return d;
}
