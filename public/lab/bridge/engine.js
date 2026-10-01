// Bridge card play (play phase only) — rules engine shared by the page, the
// Web Worker and the Node h2h harness. EXPLORATORY tier.
//
// Card id c = suit*13 + rank; rank 0..12 = 2..A; suit 0..3 = clubs, diamonds,
// hearts, spades. Strain 0..3 = that suit trumps, 4 = no-trump.
// Seats 0..3 = North, East, South, West (N/S partners, E/W partners).
// A hand is four 13-bit suit masks; a deal is a Uint16Array(16), hand of seat
// s in suit u at index s*4+u. Every count is an exact integer; there is no
// floating point anywhere in the engine or the search.

export const NORTH = 0, EAST = 1, SOUTH = 2, WEST = 3;
export const NT = 4;
export const SEAT_NAMES = ['North', 'East', 'South', 'West'];
export const SUIT_CHARS = ['♣', '♦', '♥', '♠'];
export const SUIT_LETTERS = 'CDHS';
export const RANK_CHARS = '23456789TJQKA';
export const STRAIN_NAMES = ['♣', '♦', '♥', '♠', 'NT'];

export const SUIT = new Uint8Array(52);
export const RANK = new Uint8Array(52);
for (let c = 0; c < 52; c++) { SUIT[c] = (c / 13) | 0; RANK[c] = c - SUIT[c] * 13; }

export const cardOf = (suit, rank) => suit * 13 + rank;
export const cardName = (c) => RANK_CHARS[RANK[c]] + SUIT_CHARS[SUIT[c]];
export const cardText = (c) => RANK_CHARS[RANK[c]] + SUIT_LETTERS[SUIT[c]];

export function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
export const lowBit = (m) => 31 - Math.clz32(m & -m);
export const highBit = (m) => 31 - Math.clz32(m);
const FULL = 0x1fff;

// ---------------------------------------------------------------- RNG
// xorshift32: integer-only, deterministic, seedable. Noise independent of the deal.
export class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() {
    let x = this.s;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    this.s = x;
    return x;
  }
  int(n) { return this.next() % n; }
}
export function mix(a, b) {
  let h = Math.imul((a ^ 0x85ebca6b) >>> 0, 0x9e3779b1) ^ Math.imul((b + 0x632be5ab) >>> 0, 0x85ebca77);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}

// ---------------------------------------------------------------- deals
export function randomDeal(rng) {
  const cards = new Uint8Array(52);
  for (let i = 0; i < 52; i++) cards[i] = i;
  for (let i = 51; i > 0; i--) { const j = rng.int(i + 1); const t = cards[i]; cards[i] = cards[j]; cards[j] = t; }
  const d = new Uint16Array(16);
  for (let i = 0; i < 52; i++) { const c = cards[i]; const seat = (i / 13) | 0; d[seat * 4 + SUIT[c]] |= 1 << RANK[c]; }
  return d;
}

export function hcp(d, seat) {
  let p = 0;
  for (let u = 0; u < 4; u++) {
    const m = d[seat * 4 + u];
    p += ((m >> 12) & 1) * 4 + ((m >> 11) & 1) * 3 + ((m >> 10) & 1) * 2 + ((m >> 9) & 1);
  }
  return p;
}
export const suitLen = (d, seat, u) => popcount(d[seat * 4 + u]);

// Deterministic contract rule (stands in for the auction; documented in REPORT.md).
// The side with more HCP declares (20-20: North/South). Strain: an 8+ card major
// fit (longer major; spades on a tie); else NT with 25+ HCP; else an 8+ card minor
// fit (longer minor; diamonds on a tie); else NT. Level from combined HCP.
// Declarer: in a suit, the partner with more trumps (then more HCP, then N/E);
// in NT, the partner with more HCP (then N/E).
export function contractFor(d) {
  const ns = hcp(d, NORTH) + hcp(d, SOUTH);
  const side = ns >= 20 ? 0 : 1; // 0 = N/S, 1 = E/W
  const a = side === 0 ? NORTH : EAST, b = a + 2;
  const pts = side === 0 ? ns : 40 - ns;
  const fit = (u) => suitLen(d, a, u) + suitLen(d, b, u);
  let strain = NT;
  const hs = fit(2), ss = fit(3), cs = fit(0), ds = fit(1);
  if (ss >= 8 || hs >= 8) strain = ss >= hs ? 3 : 2;
  else if (pts >= 25) strain = NT;
  else if (cs >= 8 || ds >= 8) strain = ds >= cs ? 1 : 0;
  let level;
  if (strain === NT) level = pts <= 22 ? 1 : pts <= 24 ? 2 : pts <= 32 ? 3 : pts <= 36 ? 6 : 7;
  else if (strain >= 2) {
    const tp = pts + fit(strain) - 8;
    level = tp <= 21 ? 2 : tp <= 23 ? 3 : tp <= 32 ? 4 : tp <= 36 ? 6 : 7;
  } else level = pts <= 21 ? 2 : 3;
  let decl;
  if (strain === NT) decl = hcp(d, b) > hcp(d, a) ? b : a;
  else {
    const la = suitLen(d, a, strain), lb = suitLen(d, b, strain);
    decl = lb > la ? b : la > lb ? a : hcp(d, b) > hcp(d, a) ? b : a;
  }
  return { decl, strain, level };
}

// Relabel seats so that seat `from` becomes seat `to` (partnerships preserved).
export function rotateDeal(d, k) {
  const r = new Uint16Array(16);
  for (let s = 0; s < 4; s++) for (let u = 0; u < 4; u++) r[((s + k) & 3) * 4 + u] = d[s * 4 + u];
  return r;
}

export function contractText(ct) {
  return `${ct.level}${STRAIN_NAMES[ct.strain]} by ${SEAT_NAMES[ct.decl]}`;
}

// ---------------------------------------------------------------- public state
// Everything here is public: the contract and the record of played cards
// (plus what it implies: trick winners, revealed voids). Hands are not here.
export class Pub {
  constructor(decl, strain, level) {
    this.decl = decl; this.dummy = (decl + 2) & 3; this.strain = strain; this.level = level;
    this.target = 6 + level;
    this.n = 0;
    this.plays = new Uint8Array(52); this.seatOf = new Uint8Array(52);
    this.played = new Uint16Array(4); // every played card, incl. the current trick
    this.done = new Uint16Array(4);   // cards of completed tricks
    this.leader = (decl + 1) & 3; this.tl = 0; this.tc = new Uint8Array(4);
    this.declTricks = 0; this.defTricks = 0;
    this.voids = new Uint8Array(4);   // per seat: bitmask of suits it has shown out of
    this.cnt = new Uint8Array(4);     // cards played per seat
    this.uVoid = new Uint8Array(52); this.uLeader = new Uint8Array(52); this.uWin = new Int8Array(52);
  }
  clone() {
    const p = new Pub(this.decl, this.strain, this.level);
    for (let i = 0; i < this.n; i++) p.apply(this.plays[i]);
    return p;
  }
  toMove() { return (this.leader + this.tl) & 3; }
  isDeclSide(seat) { return seat === this.decl || seat === this.dummy; }
  /** 1 made, 0 defeated, -1 undecided. */
  outcome() {
    if (this.declTricks >= this.target) return 1;
    if (this.defTricks > 13 - this.target) return 0;
    return -1;
  }
  dummyVisible() { return this.n >= 1; }
  winnerPos() { return trickWinnerPos(this.tc, this.tl, this.strain); }
  apply(c) {
    const seat = this.toMove(), s = SUIT[c], n = this.n;
    this.uVoid[n] = this.voids[seat];
    if (this.tl > 0 && s !== SUIT[this.tc[0]]) this.voids[seat] |= 1 << SUIT[this.tc[0]];
    this.played[s] |= 1 << RANK[c];
    this.plays[n] = c; this.seatOf[n] = seat; this.cnt[seat]++;
    this.tc[this.tl++] = c;
    this.uLeader[n] = this.leader; this.uWin[n] = -1;
    if (this.tl === 4) {
      const w = (this.leader + trickWinnerPos(this.tc, 4, this.strain)) & 3;
      const declWon = w === this.decl || w === this.dummy;
      if (declWon) this.declTricks++; else this.defTricks++;
      for (let i = 0; i < 4; i++) this.done[SUIT[this.tc[i]]] |= 1 << RANK[this.tc[i]];
      this.leader = w; this.tl = 0; this.uWin[n] = declWon ? 1 : 0;
    }
    this.n = n + 1;
  }
  undo() {
    const n = --this.n, c = this.plays[n], seat = this.seatOf[n];
    if (this.uWin[n] >= 0) {
      if (this.uWin[n]) this.declTricks--; else this.defTricks--;
      for (let i = 0; i < 4; i++) {
        const x = this.plays[n - 3 + i];
        this.tc[i] = x; this.done[SUIT[x]] &= ~(1 << RANK[x]);
      }
      this.leader = this.uLeader[n]; this.tl = 4;
    }
    this.tl--;
    this.played[SUIT[c]] &= ~(1 << RANK[c]);
    this.cnt[seat]--;
    this.voids[seat] = this.uVoid[n];
  }
}

export function trickWinnerPos(tc, tl, strain) {
  let best = 0;
  for (let i = 1; i < tl; i++) {
    const c = tc[i], b = tc[best];
    if (SUIT[c] === SUIT[b]) { if (RANK[c] > RANK[b]) best = i; }
    else if (SUIT[c] === strain) best = i;
  }
  return best;
}

/** Remaining hand of `seat` in deal `d` (masks into out[0..3]). */
export function handInto(out, d, seat, pub) {
  for (let u = 0; u < 4; u++) out[u] = d[seat * 4 + u] & ~pub.played[u];
  return out;
}

/** Legal cards (all of them) for a hand h[0..3] at pub. */
export function legalCards(h, pub) {
  const out = [];
  let lo = 0, hi = 3;
  if (pub.tl > 0) { const L = SUIT[pub.tc[0]]; if (h[L]) { lo = hi = L; } }
  for (let u = lo; u <= hi; u++) { let m = h[u]; while (m) { const r = lowBit(m); m &= m - 1; out.push(u * 13 + r); } }
  return out;
}

/** Legal cards with touching-equivalent cards collapsed to their lowest member.
 *  Two cards of one hand are equivalent when every rank between them is in the
 *  same hand or in a COMPLETED trick (current-trick cards still count). */
export function legalReduced(h, pub) {
  const out = [];
  let lo = 0, hi = 3;
  if (pub.tl > 0) { const L = SUIT[pub.tc[0]]; if (h[L]) { lo = hi = L; } }
  for (let u = lo; u <= hi; u++) {
    const m = h[u]; if (!m) continue;
    const filled = m | pub.done[u];
    let prevIn = false;
    for (let r = 0; r < 13; r++) {
      const bit = 1 << r;
      if (m & bit) { if (!prevIn) out.push(u * 13 + r); prevIn = true; }
      else if (!(filled & bit)) prevIn = false;
    }
  }
  return out;
}

/** Canonical representative of card c within hand h (same rule as legalReduced). */
export function canon(c, h, pub) {
  const u = SUIT[c], m = h[u], filled = m | pub.done[u];
  let r = RANK[c];
  while (r > 0) {
    const below = 1 << (r - 1);
    if (!(filled & below)) break;
    r--;
  }
  // r is now the lowest rank reachable through filled ranks; move up to the first card of m
  while (!(m & (1 << r))) r++;
  return u * 13 + r;
}

// ---------------------------------------------------------------- rule bot
// A cheap deterministic player that reads only: its own hand h, the hand of its
// partner IF that hand is visible to it (declarer <-> dummy), and the public
// record. Used as the post-horizon rollout policy and as a floor baseline.
export function ruleCard(st, seat, h, ph) {
  const strain = st.strain, declSide = seat === st.decl || seat === st.dummy;
  const played = st.played;
  if (st.tl === 0) {
    // others[u]: unplayed cards in suit u not in a hand this seat can see as its own side's
    if (declSide && strain < 4 && h[strain]) {
      const ours = h[strain] | (ph ? ph[strain] : 0);
      const out = FULL & ~played[strain] & ~ours;
      if (out && popcount(ours) > popcount(out)) {
        const top = highBit(h[strain]);
        return strain * 13 + ((1 << top) > out ? top : lowBit(h[strain]));
      }
    }
    // cash a master in a side suit where others still hold cards
    let bestMaster = -1;
    for (let u = 0; u < 4; u++) {
      if (u === strain || !h[u]) continue;
      const others = FULL & ~played[u] & ~h[u] & ~(ph ? ph[u] : 0);
      if (!others) continue;
      const top = highBit(h[u]);
      if ((1 << top) > others) { bestMaster = u * 13 + top; break; }
    }
    if (bestMaster >= 0) return bestMaster;
    // lowest card of the longest side suit (trumps only if nothing else)
    let bu = -1, bl = -1;
    for (let u = 0; u < 4; u++) {
      if (u === strain || !h[u]) continue;
      const l = popcount(h[u]);
      if (l > bl) { bl = l; bu = u; }
    }
    if (bu < 0) bu = strain;
    return bu * 13 + lowBit(h[bu]);
  }
  const L = SUIT[st.tc[0]];
  const wp = trickWinnerPos(st.tc, st.tl, strain);
  const wc = st.tc[wp];
  const winnerSeat = (st.leader + wp) & 3;
  const partnerWinning = winnerSeat === ((seat + 2) & 3);
  if (h[L]) {
    const low = L * 13 + lowBit(h[L]);
    if (partnerWinning || st.tl === 1) return low;
    if (SUIT[wc] !== L) return low; // ruffed: can't win by following
    const above = h[L] & ~((2 << RANK[wc]) - 1);
    return above ? L * 13 + lowBit(above) : low;
  }
  // discard: lowest card of the longest side suit (keeps short-suit guards)
  const discard = () => {
    let lu = -1, ll = -1;
    for (let u = 0; u < 4; u++) {
      if (u === strain || !h[u]) continue;
      const l = popcount(h[u]);
      if (l > ll) { ll = l; lu = u; }
    }
    if (lu < 0) lu = strain;
    return lu * 13 + lowBit(h[lu]);
  };
  if (partnerWinning || strain === 4 || !h[strain]) return discard();
  if (SUIT[wc] === strain) {
    const above = h[strain] & ~((2 << RANK[wc]) - 1);
    return above ? strain * 13 + lowBit(above) : discard();
  }
  return strain * 13 + lowBit(h[strain]);
}

// ---------------------------------------------------------------- rollouts
// A light simulator for post-horizon playouts: no undo bookkeeping.
export class Sim {
  constructor() {
    this.played = new Uint16Array(4); this.done = new Uint16Array(4); this.tc = new Uint8Array(4);
    this.hands = new Uint16Array(16);
    this.h = new Uint16Array(4); this.ph = new Uint16Array(4);
  }
  load(pub, d) {
    this.decl = pub.decl; this.dummy = pub.dummy; this.strain = pub.strain; this.target = pub.target;
    for (let u = 0; u < 4; u++) { this.played[u] = pub.played[u]; this.done[u] = pub.done[u]; }
    for (let i = 0; i < 16; i++) this.hands[i] = d[i] & ~pub.played[i & 3];
    this.leader = pub.leader; this.tl = pub.tl;
    for (let i = 0; i < pub.tl; i++) this.tc[i] = pub.tc[i];
    this.declTricks = pub.declTricks; this.defTricks = pub.defTricks;
  }
  /** Play on until declarer has `hi` tricks or cannot reach `lo` (mode 0 = rule bot,
   *  1 = random). Returns declarer's tricks at that point. */
  run(mode, rng, hi, lo) {
    const hands = this.hands, h = this.h, ph = this.ph, defMax = 13 - lo;
    for (;;) {
      if (this.declTricks >= hi || this.defTricks > defMax || this.declTricks + this.defTricks === 13) return this.declTricks;
      const seat = (this.leader + this.tl) & 3;
      for (let u = 0; u < 4; u++) h[u] = hands[seat * 4 + u];
      let c;
      if (mode === 1) {
        let lo = 0, hi = 3, tot = 0;
        if (this.tl > 0) { const L = SUIT[this.tc[0]]; if (h[L]) lo = hi = L; }
        for (let u = lo; u <= hi; u++) tot += popcount(h[u]);
        let k = rng.int(tot);
        for (let u = lo; u <= hi; u++) {
          const l = popcount(h[u]);
          if (k < l) { let m = h[u]; while (k--) m &= m - 1; c = u * 13 + lowBit(m); break; }
          k -= l;
        }
      } else {
        let pp = null;
        if (seat === this.decl || seat === this.dummy) {
          const p = (seat + 2) & 3;
          for (let u = 0; u < 4; u++) ph[u] = hands[p * 4 + u];
          pp = ph;
        }
        c = ruleCard(this, seat, h, pp);
      }
      const s = SUIT[c], bit = 1 << RANK[c];
      hands[seat * 4 + s] &= ~bit; this.played[s] |= bit;
      this.tc[this.tl++] = c;
      if (this.tl === 4) {
        const w = (this.leader + trickWinnerPos(this.tc, 4, this.strain)) & 3;
        if (w === this.decl || w === this.dummy) this.declTricks++; else this.defTricks++;
        for (let i = 0; i < 4; i++) this.done[SUIT[this.tc[i]]] |= 1 << RANK[this.tc[i]];
        this.leader = w; this.tl = 0;
      }
    }
  }
}

// ---------------------------------------------------------------- sampling
/** Which seats' remaining hands `agent` sees at pub. The declarer agent sees
 *  declarer + dummy; a defender sees its own hand, plus dummy once the opening
 *  lead is on the table. */
export function visibleSeats(agent, pub) {
  if (agent === pub.decl) return (1 << pub.decl) | (1 << pub.dummy);
  return (1 << agent) | (pub.dummyVisible() ? 1 << pub.dummy : 0);
}

/** n deals (remaining hands) consistent with what `agent` sees: the hands in
 *  `known` for the seats in `vis`, hand sizes, and revealed voids. Uniform over
 *  the consistent deals (no inference from anyone's policy). */
export function sampleDeals(pub, vis, known, n, rng) {
  const unknown = [];
  for (let s = 0; s < 4; s++) if (!(vis & (1 << s))) unknown.push(s);
  const rest = new Uint16Array(4);
  for (let u = 0; u < 4; u++) {
    let m = FULL & ~pub.played[u];
    for (let s = 0; s < 4; s++) if (vis & (1 << s)) m &= ~known[s * 4 + u];
    rest[u] = m;
  }
  const need = unknown.map((s) => 13 - pub.cnt[s]);
  const out = [];
  const base = new Uint16Array(16);
  for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) base[s * 4 + u] = known[s * 4 + u] & ~pub.played[u];
  if (unknown.length === 2) {
    const [A, B] = unknown;
    const forcedA = new Uint16Array(4), forcedB = new Uint16Array(4);
    const free = [];
    let nA = need[0];
    for (let u = 0; u < 4; u++) {
      const vA = pub.voids[A] & (1 << u), vB = pub.voids[B] & (1 << u);
      if (vA && vB) { if (rest[u]) throw new Error('inconsistent voids'); continue; }
      if (vA) forcedB[u] = rest[u];
      else if (vB) { forcedA[u] = rest[u]; nA -= popcount(rest[u]); }
      else { let m = rest[u]; while (m) { const r = lowBit(m); m &= m - 1; free.push(u * 13 + r); } }
    }
    if (nA < 0 || nA > free.length) throw new Error('inconsistent hand sizes');
    const f = free.slice();
    for (let k = 0; k < n; k++) {
      const d = base.slice();
      for (let u = 0; u < 4; u++) { d[A * 4 + u] |= forcedA[u]; d[B * 4 + u] |= forcedB[u]; }
      for (let i = 0; i < f.length; i++) {
        if (i < nA) { const j = i + rng.int(f.length - i); const t = f[i]; f[i] = f[j]; f[j] = t; }
        const c = f[i];
        d[(i < nA ? A : B) * 4 + SUIT[c]] |= 1 << RANK[c];
      }
      out.push(d);
    }
    return out;
  }
  // 3 (or 1) unknown seats: shuffle-and-deal, rejecting void violations.
  const all = [];
  for (let u = 0; u < 4; u++) { let m = rest[u]; while (m) { const r = lowBit(m); m &= m - 1; all.push(u * 13 + r); } }
  for (let k = 0; k < n; k++) {
    for (let tries = 0; ; tries++) {
      if (tries > 100000) throw new Error('sampler failed');
      for (let i = all.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = all[i]; all[i] = all[j]; all[j] = t; }
      const d = base.slice();
      let i = 0, ok = true;
      for (let q = 0; q < unknown.length && ok; q++) {
        const s = unknown[q];
        for (let t = 0; t < need[q]; t++) {
          const c = all[i++];
          if (pub.voids[s] & (1 << SUIT[c])) { ok = false; break; }
          d[s * 4 + SUIT[c]] |= 1 << RANK[c];
        }
      }
      if (ok) { out.push(d); break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- PBN helper (for DDS)
/** PBN "N:..." of the given full hands (seat order N,E,S,W). */
export function toPBN(d) {
  const hs = [];
  for (let s = 0; s < 4; s++) {
    const parts = [];
    for (let u = 3; u >= 0; u--) {
      let t = '';
      for (let r = 12; r >= 0; r--) if (d[s * 4 + u] & (1 << r)) t += RANK_CHARS[r];
      parts.push(t);
    }
    hs.push(parts.join('.'));
  }
  return 'N:' + hs.join(' ');
}
