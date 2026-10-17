// Skat play phase: rules, setup, public state, sampler, simple bots.
// Shared by the browser worker and the Node h2h harness (lab/skat/).
// Cards are bits 0..31 of an int32 mask: card = suit*8 + rank.
//   suit 0=♣ 1=♠ 2=♥ 3=♦ ; rank 0..7 = 7 8 9 Q K 10 A J
// Game type g: 0..3 = suit game with that trump suit, 4 = grand (jacks only).
// All arithmetic on points / counts is exact integer arithmetic.

export const SUITS = ['♣', '♠', '♥', '♦'];
export const SUIT_NAMES = ['Clubs', 'Spades', 'Hearts', 'Diamonds'];
export const RANKS = ['7', '8', '9', 'Q', 'K', '10', 'A', 'J'];
export const PTS_R = [0, 0, 0, 3, 4, 10, 11, 2];
export const GAME_NAMES = ['Clubs', 'Spades', 'Hearts', 'Diamonds', 'Grand'];
export const TRUMP = 4; // effective-suit index of trumps
export const ALL = -1; // all 32 bits

export const suitOf = (c) => c >> 3;
export const rankOf = (c) => c & 7;
export const PTS = Array.from({ length: 32 }, (_, c) => PTS_R[c & 7]);
export const cardName = (c) => RANKS[c & 7] + SUITS[c >> 3];

export function popcount(m) {
  m = m - ((m >>> 1) & 0x55555555);
  m = (m & 0x33333333) + ((m >>> 2) & 0x33333333);
  return (Math.imul((m + (m >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}
export const lowBit = (m) => 31 - Math.clz32(m & -m);
export function bits(m) {
  const out = [];
  while (m) { const b = m & -m; out.push(31 - Math.clz32(b)); m ^= b; }
  return out;
}
export function maskOf(cards) { let m = 0; for (const c of cards) m |= 1 << c; return m; }
export function pointsOf(m) { let p = 0; while (m) { const b = m & -m; p += PTS[31 - Math.clz32(b)]; m ^= b; } return p; }

export const JACKS = (1 << 7) | (1 << 15) | (1 << 23) | (1 << 31);
const SUIT_NJ = [0, 1, 2, 3].map((s) => 0x7f << (s * 8)); // non-jack cards of a suit

// EFF[g][s] = mask of cards of effective suit s (0..3 plain, 4 = trump) in game g.
export const EFF = [0, 1, 2, 3, 4].map((g) => {
  const e = [0, 0, 0, 0, 0];
  for (let s = 0; s < 4; s++) e[s] = s === g ? 0 : SUIT_NJ[s];
  e[TRUMP] = JACKS | (g < 4 ? SUIT_NJ[g] : 0);
  return e;
});
// ESUIT[g][c] = effective suit of c; STR[g][c] = strength within its effective suit.
export const ESUIT = [0, 1, 2, 3, 4].map((g) =>
  Array.from({ length: 32 }, (_, c) => ((EFF[g][TRUMP] >> c) & 1 ? TRUMP : c >> 3)));
export const STR = [0, 1, 2, 3, 4].map((g) =>
  Array.from({ length: 32 }, (_, c) => {
    const r = c & 7, s = c >> 3;
    if (r === 7) return 20 + (3 - s); // ♣J 23 > ♠J > ♥J > ♦J 20
    return r; // 7<8<9<Q<K<10<A within any suit (trump suit or plain)
  }));
// ORDER[g][s] = cards of effective suit s, weakest first.
export const ORDER = [0, 1, 2, 3, 4].map((g) => [0, 1, 2, 3, 4].map((s) =>
  bits(EFF[g][s]).sort((a, b) => STR[g][a] - STR[g][b])));

/** does card c beat the current best card `best` (given game g)? */
export function beats(g, c, best) {
  const ec = ESUIT[g][c], eb = ESUIT[g][best];
  if (ec === eb) return STR[g][c] > STR[g][best];
  return ec === TRUMP;
}
export function trickWinnerIdx(g, cards) {
  let w = 0;
  for (let i = 1; i < cards.length; i++) if (beats(g, cards[i], cards[w])) w = i;
  return w;
}

// ---------------------------------------------------------------- RNG
// mulberry32: integer-only PRNG.
export function makeRng(seed) {
  let a = seed | 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const int = (n) => { // uniform integer in [0, n), n <= 2^32, rejection to remove bias
    const lim = 4294967296 - (4294967296 % n);
    for (;;) { const r = next(); if (r < lim) return r % n; }
  };
  const big = (n) => { // integer in [0, n) for n < 2^53 (bias < n / 2^53)
    const r = next() * 2097152 + (next() >>> 11);
    return r % n;
  };
  return { next, int, big };
}
export function hash32(a, b, c = 0) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------- public state
// pub = { g, decl, turn, leader, trick:[cards], played (mask incl. current trick),
//         nPlayed, declPts, defPts (completed tricks only), voids:[3 masks over eff suits] }
export function initialPublic(g, decl) {
  return { g, decl, turn: 0, leader: 0, trick: [], played: 0, nPlayed: 0, declPts: 0, defPts: 0, voids: [0, 0, 0] };
}

export function legalMask(hand, pub) {
  if (pub.trick.length === 0) return hand;
  const f = hand & EFF[pub.g][ESUIT[pub.g][pub.trick[0]]];
  return f || hand;
}
export const legalList = (hand, pub) => bits(legalMask(hand, pub));

/** public state after the player to move plays card c (assumed legal). */
export function play(pub, c) {
  const g = pub.g, seat = pub.turn;
  let voids = pub.voids;
  if (pub.trick.length > 0) {
    const ls = ESUIT[g][pub.trick[0]];
    if (ESUIT[g][c] !== ls && !((voids[seat] >> ls) & 1)) {
      voids = voids.slice(); voids[seat] |= 1 << ls;
    }
  }
  const trick = pub.trick.concat(c);
  const played = pub.played | (1 << c);
  const nPlayed = pub.nPlayed + 1;
  if (trick.length < 3) {
    return { g, decl: pub.decl, turn: (seat + 1) % 3, leader: pub.leader, trick, played, nPlayed,
      declPts: pub.declPts, defPts: pub.defPts, voids };
  }
  const w = (pub.leader + trickWinnerIdx(g, trick)) % 3;
  const pts = PTS[trick[0]] + PTS[trick[1]] + PTS[trick[2]];
  const toDecl = w === pub.decl;
  return { g, decl: pub.decl, turn: w, leader: w, trick: [], played, nPlayed,
    declPts: pub.declPts + (toDecl ? pts : 0), defPts: pub.defPts + (toDecl ? 0 : pts), voids };
}

/** cards still held by `seat` (10 minus what it has played). */
export function handSize(pub, seat) {
  const k = pub.trick.length;
  const done = (pub.nPlayed - k) / 3;
  const inTrick = ((seat - pub.leader + 3) % 3) < k ? 1 : 0;
  return 10 - done - inTrick;
}

// deal = { h:[3 masks of cards still held or to be held], skat: mask (declarer's discard), sp: skat points }
export const privateOf = (deal, seat, pub) => ({
  hand: deal.h[seat] & ~pub.played,
  discard: seat === pub.decl ? deal.skat : 0,
});

/** binary outcome for one deal: true / false / null (undecided). Exact early resolution:
 *  declarer's final points = declPts + skat points + future trick points (monotone). */
export function outcomeDeal(pub, sp) {
  if (pub.declPts + sp >= 61) return true;
  if (pub.defPts >= 60) return false;
  if (pub.nPlayed === 30) return false;
  return null;
}

// ---------------------------------------------------------------- sampler
// Uniform over all deals consistent with what `seat` sees: its own hand (and discard if
// declarer), the public record, hand sizes, and revealed voids. Exact counts by DP over
// effective-suit groups (counts < 2^53, exact in JS integers).
export function sampleDeals(seat, priv, pub, n, rng) {
  const g = pub.g, decl = pub.decl;
  const known = pub.played | priv.hand | (seat === decl ? priv.discard : 0);
  const U = ~known;
  const holders = []; // seat indices, or 3 for the skat
  for (let s = 0; s < 3; s++) if (s !== seat) holders.push(s);
  if (seat !== decl) holders.push(3);
  const caps0 = holders.map((h) => (h === 3 ? 2 : handSize(pub, h)));
  const groups = [];
  for (let s = 0; s <= 4; s++) {
    const m = U & EFF[g][s];
    if (!m) continue;
    const allow = holders.map((h) => (h === 3 ? true : !((pub.voids[h] >> s) & 1)));
    groups.push({ cards: bits(m), allow });
  }
  const H = holders.length;
  const memo = new Map();
  const C = binomTable();
  const count = (i, caps) => {
    if (i === groups.length) return caps.every((x) => x === 0) ? 1 : 0;
    const key = i * 4096 + caps[0] * 256 + caps[1] * 16 + (caps[2] || 0);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let tot = 0;
    forDist(groups[i], caps, H, (x, w) => {
      tot += w * count(i + 1, caps.map((c, j) => c - x[j]));
    }, C);
    memo.set(key, tot);
    return tot;
  };
  const total = count(0, caps0);
  if (total === 0) throw new Error('sampleDeals: no consistent deal');
  const deals = [];
  for (let k = 0; k < n; k++) {
    const hands = [0, 0, 0]; let skat = seat === decl ? priv.discard : 0;
    hands[seat] = priv.hand;
    let caps = caps0.slice();
    for (let i = 0; i < groups.length; i++) {
      const opts = [];
      let tot = 0;
      forDist(groups[i], caps, H, (x, w) => {
        const ww = w * count(i + 1, caps.map((c, j) => c - x[j]));
        if (ww > 0) { opts.push([x.slice(), ww]); tot += ww; }
      }, C);
      let r = rng.big(tot), pick = opts[opts.length - 1][0];
      for (const [x, w] of opts) { if (r < w) { pick = x; break; } r -= w; }
      const cs = groups[i].cards.slice();
      for (let j = cs.length - 1; j > 0; j--) { const t = rng.int(j + 1); const tmp = cs[j]; cs[j] = cs[t]; cs[t] = tmp; }
      let p = 0;
      for (let hI = 0; hI < H; hI++) {
        for (let q = 0; q < pick[hI]; q++) {
          const c = cs[p++];
          if (holders[hI] === 3) skat |= 1 << c; else hands[holders[hI]] |= 1 << c;
        }
      }
      caps = caps.map((c, j) => c - pick[j]);
    }
    deals.push({ h: hands, skat, sp: pointsOf(skat), id: k });
  }
  return deals;
}
let _C = null;
function binomTable() {
  if (_C) return _C;
  _C = [];
  for (let i = 0; i <= 32; i++) { _C.push([]); for (let j = 0; j <= i; j++) _C[i].push(j === 0 || j === i ? 1 : _C[i - 1][j - 1] + _C[i - 1][j]); }
  return _C;
}
function forDist(group, caps, H, fn, C) {
  const k = group.cards.length;
  const x = new Array(H).fill(0);
  const rec = (j, left, w) => {
    if (j === H - 1) {
      if (left > 0 && !group.allow[j]) return;
      if (left > caps[j]) return;
      x[j] = left; fn(x, w); return;
    }
    const mx = group.allow[j] ? Math.min(left, caps[j]) : 0;
    for (let v = 0; v <= mx; v++) { x[j] = v; rec(j + 1, left - v, w * C[left][v]); }
  };
  rec(0, k, 1);
}

// ---------------------------------------------------------------- setup: deal, declarer, game, discard
export function dealCards(rng) {
  const d = Array.from({ length: 32 }, (_, i) => i);
  for (let j = 31; j > 0; j--) { const t = rng.int(j + 1); const tmp = d[j]; d[j] = d[t]; d[t] = tmp; }
  const hands = [0, 1, 2].map((s) => maskOf(d.slice(s * 10, s * 10 + 10)));
  return { hands, skat: maskOf(d.slice(30)) };
}

/** heuristic strength of a 10-card holding for game g (integer). */
export function handScore(h, g) {
  const e = EFF[g];
  const j = popcount(h & JACKS);
  let sc = 0;
  if (g < 4) {
    const t = popcount(h & e[TRUMP]);
    sc += 10 * t + 4 * j + ((h >> 7) & 1 ? 4 : 0) + ((h >> 15) & 1 ? 2 : 0);
    if (t < 5) sc -= 15 * (5 - t);
  } else {
    sc += 16 * j + ((h >> 7) & 1 ? 6 : 0) + ((h >> 15) & 1 ? 3 : 0);
    if (j < 2) sc -= 30;
  }
  for (let s = 0; s < 4; s++) {
    const m = h & e[s];
    if (!e[s]) continue;
    const n = popcount(m);
    const A = (m >> (s * 8 + 6)) & 1, T = (m >> (s * 8 + 5)) & 1, K = (m >> (s * 8 + 4)) & 1;
    if (n === 0) { sc += g < 4 ? 7 : 2; continue; }
    if (A) sc += 12;
    if (T) sc += A ? 9 : (n >= 3 ? 2 : -5);
    if (K && A && T) sc += 4;
    if (!A && n === 1) sc -= 3;
    if (g === 4 && A && T) sc += 5 * (n - 2);
    if (g === 4 && !A) sc -= 6;
  }
  return sc;
}

/** strongest seat declares (deterministic rule; replaces the auction). */
export function chooseDeclarer(hands) {
  let best = -1e9, who = 0;
  for (let s = 0; s < 3; s++) {
    let b = -1e9;
    for (let g = 0; g <= 4; g++) b = Math.max(b, handScore(hands[s], g));
    if (b > best) { best = b; who = s; }
  }
  return who;
}

/** declarer has picked up the skat (12 cards): choose game and 2-card discard. */
export function chooseGameAndDiscard(h12) {
  const cs = bits(h12);
  let best = null;
  for (let g = 0; g <= 4; g++) {
    for (let i = 0; i < cs.length; i++) for (let k = i + 1; k < cs.length; k++) {
      const dm = (1 << cs[i]) | (1 << cs[k]);
      const sc = handScore(h12 & ~dm, g) + pointsOf(dm) - (popcount(dm & EFF[g][TRUMP]) ? 8 : 0);
      if (!best || sc > best.sc) best = { sc, g, discard: dm };
    }
  }
  return best;
}

/** whole setup for a seeded deal: returns the true deal for the play phase. */
export function setupDeal(seed) {
  const rng = makeRng(seed);
  const { hands, skat } = dealCards(rng);
  const decl = chooseDeclarer(hands);
  const h12 = hands[decl] | skat;
  const { g, discard } = chooseGameAndDiscard(h12);
  const h = hands.slice(); h[decl] = h12 & ~discard;
  return { seed, preHands: hands, origSkat: skat, decl, g, deal: { h, skat: discard, sp: pointsOf(discard) } };
}

// ---------------------------------------------------------------- simple bots
export function randomMove(hand, pub, rng) {
  const l = legalList(hand, pub);
  return l[rng.int(l.length)];
}

/** lawful rule-based player: reads only its own hand and the public record. */
export function ruleMove(hand, pub) {
  const g = pub.g, me = pub.turn, isDecl = me === pub.decl;
  const legal = legalMask(hand, pub);
  if ((legal & (legal - 1)) === 0) return lowBit(legal);
  const e = EFF[g];
  const outside = ~pub.played & ~hand; // cards I can't see (others' hands / skat)
  const L = bits(legal);
  const lowest = (cs) => cs.reduce((a, b) => (key(b) < key(a) ? b : a));
  const key = (c) => PTS[c] * 64 + (ESUIT[g][c] === TRUMP ? 32 : 0) + STR[g][c];
  const isTop = (c) => { // no unseen card of its eff suit beats it
    const s = ESUIT[g][c];
    for (const o of bits(outside & e[s])) if (STR[g][o] > STR[g][c]) return false;
    return true;
  };
  if (pub.trick.length === 0) {
    if (isDecl) {
      const tr = L.filter((c) => ESUIT[g][c] === TRUMP);
      if (tr.length && (outside & e[TRUMP])) {
        const top = tr.filter(isTop);
        if (top.length) return top.reduce((a, b) => (STR[g][b] > STR[g][a] ? b : a));
        if (tr.length >= 3) return lowest(tr);
      }
      const aces = L.filter((c) => ESUIT[g][c] !== TRUMP && isTop(c) && PTS[c] >= 10);
      if (aces.length) return aces.reduce((a, b) => (PTS[b] > PTS[a] ? b : a));
      const side = L.filter((c) => ESUIT[g][c] !== TRUMP);
      return lowest(side.length ? side : L);
    }
    const aces = L.filter((c) => ESUIT[g][c] !== TRUMP && isTop(c) && PTS[c] >= 10);
    if (aces.length) return aces[0];
    const side = L.filter((c) => ESUIT[g][c] !== TRUMP);
    return lowest(side.length ? side : L);
  }
  const t = pub.trick;
  const wi = trickWinnerIdx(g, t);
  const wSeat = (pub.leader + wi) % 3;
  const wCard = t[wi];
  const last = t.length === 2;
  const partnerWinning = !isDecl && wSeat !== pub.decl;
  const winners = L.filter((c) => beats(g, c, wCard));
  if (partnerWinning) {
    if (last || isTop(wCard)) return L.reduce((a, b) => (PTS[b] * 64 - STR[g][b] > PTS[a] * 64 - STR[g][a] ? b : a));
    return lowest(L);
  }
  if (winners.length) {
    const cheapest = winners.reduce((a, b) => (key(b) < key(a) ? b : a));
    const trickPts = t.reduce((s, c) => s + PTS[c], 0);
    if (last) {
      if (trickPts > 0 || ESUIT[g][cheapest] !== TRUMP || PTS[cheapest] > 0) return cheapest;
      return lowest(L);
    }
    const sure = winners.filter(isTop);
    if (sure.length) return sure.reduce((a, b) => (key(b) < key(a) ? b : a));
    if (trickPts >= 10) return cheapest;
  }
  return lowest(L);
}

/** legal moves in a deal-independent preference order used only to break exact ties:
 *  the rule bot's choice first, then cheaper cards first. Reads own hand + public only. */
export function orderedLegal(hand, pub) {
  const L = legalList(hand, pub);
  if (L.length <= 1) return L;
  const r = ruleMove(hand, pub), g = pub.g;
  const rest = L.filter((c) => c !== r).sort((a, b) => (PTS[a] - PTS[b]) || (STR[g][a] - STR[g][b]) || (a - b));
  return [r, ...rest];
}
