// Stochastic similarity: shared data layer. EXPLORATORY tier.
//
// Loads pmake-vector corpus rows (collect.mjs output), reconstructs every
// decision position by replaying `plays` through Pub, and featurizes each
// (position, candidate) pair.
//
// Information rule: every feature reads only the deciding agent's own visible
// hands (its seat's remaining hand; dummy / declarer partner when visible to
// that agent) and the public record. Nothing reads a hand the agent cannot see.
import { readFileSync } from 'node:fs';
import {
  Pub, SUIT, RANK, legalReduced, trickWinnerPos, visibleSeats, ruleCard, canon,
} from '../../../public/lab/bridge/engine.js';
import { agentOf } from '../../../public/lab/bridge/walt.js';

const RANK_CHARS = '23456789TJQKA', SUIT_LETTERS = 'CDHS';

export function parsePBN(pbn) {
  const d = new Uint16Array(16);
  pbn.slice(2).split(' ').forEach((hand, s) => hand.split('.').forEach((cards, k) => {
    const u = 3 - k; for (const ch of cards) d[s * 4 + u] |= 1 << RANK_CHARS.indexOf(ch);
  }));
  return d;
}

export const cardFromText = (t) => SUIT_LETTERS.indexOf(t[1]) * 13 + RANK_CHARS.indexOf(t[0]);

export function loadDeals(path) {
  return JSON.parse(readFileSync(path, 'utf8')).deals;
}

export function loadCorpus(path) {
  return readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

const popcount = (x) => { let n = 0; while (x) { x &= x - 1; n++; } return n; };
const lowRank = (m) => 31 - Math.clz32(m & -m);
const highRank = (m) => 31 - Math.clz32(m);

export const FEATURE_NAMES = [
  // position-level
  'isNT', 'level', 'need', 'defNeed', 'remTricks', 'needRatio', 'tl', 'isDeclSide',
  'isDummyTurn', 'pliesLeft', 'nCands', 'ownTrumpLen', 'ledLenOwn', 'partnerWinning',
  'oppWinning', 'oppVoidsShown',
  // candidate-level
  'isTrump', 'followsLed', 'isDiscard', 'isLead', 'wouldWinNow', 'higherUnseen',
  'higherPartnerKnown', 'higherOppKnown', 'isMaster', 'higherOwn', 'suitLenOwn', 'rankFrac',
  'isRuleCard', 'isLowestOfSuit', 'isHighestOfSuit', 'isRuff', 'ledByPartner', 'trickIdx',
];

/** Features for one candidate card at a reconstructed position.
 *  hSeat: remaining hand (Uint16Array(4)) of the seat on play.
 *  visHands: per-seat remaining hands the agent can see (null if unseen). */
function featurize(pub, seat, agent, hSeat, visHands, nCands, c, ruleC) {
  const u = SUIT[c], r = RANK[c];
  const target = pub.target;
  const need = target - pub.declTricks;
  const defNeed = (13 - target + 1) - pub.defTricks;
  const remTricks = 13 - pub.declTricks - pub.defTricks;
  const declSide = pub.isDeclSide(seat);
  const tl = pub.tl;
  const led = tl > 0 ? SUIT[pub.tc[0]] : -1;
  // who currently wins the trick on the table (relative to seat's side)
  let partnerWinning = 0, oppWinning = 0;
  if (tl > 0) {
    const wSeat = (pub.leader + trickWinnerPos(pub.tc, tl, pub.strain)) & 3;
    if (((wSeat ^ seat) & 1) === 0 && wSeat !== seat) partnerWinning = 1;
    if (((wSeat ^ seat) & 1) === 1) oppWinning = 1;
  }
  // would this card win the trick as it stands now?
  let wouldWinNow = 0;
  if (tl === 0) wouldWinNow = 1;
  else {
    const tc = pub.tc.slice(); tc[tl] = c;
    wouldWinNow = trickWinnerPos(tc, tl + 1, pub.strain) === tl ? 1 : 0;
  }
  // higher cards of this suit, unplayed, split by where they sit from the
  // agent's point of view: in the playing seat's own hand, in another visible
  // hand on the seat's side, in a visible opponent hand (a defender sees
  // dummy), or unseen.
  let higherUnseen = 0, higherOwn = 0, higherPartnerKnown = 0, higherOppKnown = 0;
  for (let rr = r + 1; rr < 13; rr++) {
    const bit = 1 << rr;
    if (pub.played[u] & bit) continue;
    if (hSeat[u] & bit) { higherOwn++; continue; }
    let owner = -1;
    for (let s = 0; s < 4; s++) if (s !== seat && visHands[s] && (visHands[s][u] & bit)) { owner = s; break; }
    if (owner < 0) higherUnseen++;
    else if (pub.isDeclSide(owner) === declSide) higherPartnerKnown++;
    else higherOppKnown++;
  }
  // master: no card that could beat c remains in an unseen or visible-opponent hand
  const isMaster = higherUnseen === 0 && higherOppKnown === 0 ? 1 : 0;
  // opponents' publicly shown voids (void bits are public record)
  const opp1 = (seat + 1) & 3, opp2 = (seat + 3) & 3;
  const oppVoidsShown = popcount(pub.voids[opp1]) + popcount(pub.voids[opp2]);
  return [
    pub.strain === 4 ? 1 : 0, pub.level, need, defNeed, remTricks,
    remTricks > 0 ? need / remTricks : 0, tl, declSide ? 1 : 0,
    seat === pub.dummy ? 1 : 0, 52 - pub.n, nCands,
    pub.strain < 4 ? popcount(hSeat[pub.strain]) : 0,
    led >= 0 ? popcount(hSeat[led]) : 0, partnerWinning, oppWinning, oppVoidsShown,
    u === pub.strain ? 1 : 0, led >= 0 && u === led ? 1 : 0,
    led >= 0 && u !== led && u !== pub.strain ? 1 : 0, tl === 0 ? 1 : 0,
    wouldWinNow, higherUnseen, higherPartnerKnown, higherOppKnown, isMaster, higherOwn,
    popcount(hSeat[u]), r / 12,
    c === ruleC ? 1 : 0,
    hSeat[u] && r === lowRank(hSeat[u]) ? 1 : 0,
    hSeat[u] && r === highRank(hSeat[u]) ? 1 : 0,
    tl > 0 && u === pub.strain && led !== pub.strain && hSeat[led] === 0 ? 1 : 0,
    tl > 0 && pub.leader === ((seat + 2) & 3) ? 1 : 0,
    pub.n >> 2,
  ];
}

/** Build (position, candidate) records from corpus rows.
 *  Each record: { group, board, ply, seat, card, y, pick, feat, decId,
 *                 vMin, vMax, deals }.
 *  group = `${tag}:${board}` identifies the underlying deal for split hygiene.
 *  Throws if reconstruction disagrees with the recorded vectors. */
export function buildDataset(rows, deals, tag) {
  const recs = [];
  let decId0 = 0;
  for (const row of rows) {
    const D = deals[row.board];
    if (!D) throw new Error(`board ${row.board} missing from deals file`);
    const deal = parsePBN(D.pbn);
    const pub = new Pub(row.decl, row.strain, row.level);
    const plays = row.plays.split(' ').map(cardFromText);
    const byPly = new Map(row.vectors.map((v) => [v.ply, v]));
    for (let i = 0; i < plays.length; i++) {
      const vec = byPly.get(pub.n);
      if (vec) {
        const seat = pub.toMove();
        if (seat !== vec.seat) throw new Error(`seat mismatch b${row.board} ply${pub.n}`);
        const agent = agentOf(pub, seat);
        const vis = visibleSeats(agent, pub);
        const hSeat = new Uint16Array(4);
        const visHands = [null, null, null, null];
        for (let s = 0; s < 4; s++) if (vis & (1 << s)) {
          const h = new Uint16Array(4);
          for (let uu = 0; uu < 4; uu++) h[uu] = deal[s * 4 + uu] & ~pub.played[uu];
          visHands[s] = h;
        }
        for (let uu = 0; uu < 4; uu++) hSeat[uu] = deal[seat * 4 + uu] & ~pub.played[uu];
        const legal = new Set(legalReduced(hSeat, pub));
        const ph = agent === pub.decl ? visHands[(seat + 2) & 3] : null;
        const ruleC = canon(ruleCard(pub, seat, hSeat, ph), hSeat, pub);
        let vMin = Infinity, vMax = -Infinity;
        for (const [c, m] of vec.v) { if (m < vMin) vMin = m; if (m > vMax) vMax = m; }
        const decId = decId0++;
        for (const [c, makes, nDeals] of vec.v) {
          if (!legal.has(c)) throw new Error(`candidate ${c} not legal b${row.board} ply${pub.n}`);
          recs.push({
            group: `${tag}:${row.board}`, board: row.board, tag, ply: pub.n, seat,
            card: c, y: makes / nDeals, makes, deals: nDeals, pick: vec.pick === c ? 1 : 0,
            decId, vMin, vMax, nCands: vec.v.length,
            feat: featurize(pub, seat, agent, hSeat, visHands, vec.v.length, c, ruleC),
          });
        }
      }
      pub.apply(plays[i]);
    }
    if (pub.outcome() < 0) throw new Error(`board ${row.board}: replay did not finish`);
    if ((pub.outcome() === 1 ? 1 : 0) !== row.made) throw new Error(`board ${row.board}: outcome mismatch`);
  }
  return recs;
}
