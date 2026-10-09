// Lawful per-candidate features + the tiny scorer forward pass, shared by the
// offline trainer (lab/bridge/scorer/) and the in-search scorer mind (tape.js,
// l0:'scorer'). EXPLORATORY tier.
//
// Information rule: every feature reads only the deciding agent's own visible
// hands (its seat's remaining hand; dummy / declarer partner when visible to
// that agent) and the public record. Nothing reads a hand the agent cannot
// see. Moved verbatim from lab/bridge/similarity/data.mjs so training and
// inference cannot drift apart.
import { SUIT, RANK, trickWinnerPos } from './engine.js';

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
  // v2: bridge structure, still lawful (visible hands + public record only)
  'sideWinnersSuit', 'quickWinnersTotal', 'winnersVsNeed', 'oppTrumpsPossible',
  'sideTrumpsSeen', 'tenaceOverUnseen', 'entriesPartner', 'cheapestWinner',
  'handPos2', 'handPos3', 'handPos4', 'oppVoidInSuit', 'partnerVoidInSuit',
  'suitEstablished', 'honorsOwnSuit', 'underPartnerWinner',
];

/** Features for one candidate card at a position.
 *  hSeat: remaining hand (Uint16Array(4)) of the seat on play.
 *  visHands: per-seat remaining hands the agent can see (null if unseen). */
export function featurize(pub, seat, agent, hSeat, visHands, nCands, c, ruleC) {
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
  // agent's point of view
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
  const isMaster = higherUnseen === 0 && higherOppKnown === 0 ? 1 : 0;
  const opp1 = (seat + 1) & 3, opp2 = (seat + 3) & 3;
  const oppVoidsShown = popcount(pub.voids[opp1]) + popcount(pub.voids[opp2]);

  // --- v2: bridge structure, all from visible hands + public record ---
  const FULL13 = 0x1fff;
  const sideVis = [0, 0, 0, 0], oppVis = [0, 0, 0, 0], visAll = [0, 0, 0, 0];
  let partnerVis = null;
  for (let s = 0; s < 4; s++) {
    if (!visHands[s]) continue;
    const sameSide = pub.isDeclSide(s) === declSide;
    for (let uu = 0; uu < 4; uu++) {
      visAll[uu] |= visHands[s][uu];
      if (sameSide) sideVis[uu] |= visHands[s][uu]; else oppVis[uu] |= visHands[s][uu];
    }
    if (sameSide && s !== seat) partnerVis = visHands[s];
  }
  const unseen = [0, 0, 0, 0];
  for (let uu = 0; uu < 4; uu++) unseen[uu] = FULL13 & ~pub.played[uu] & ~visAll[uu];
  // consecutive top winners a suit's own side holds (quick winners)
  const winnersIn = (uu) => {
    let w = 0;
    for (let rr = 12; rr >= 0; rr--) {
      const bit = 1 << rr;
      if (pub.played[uu] & bit) continue;
      if (sideVis[uu] & bit) w++; else break;
    }
    return w;
  };
  const sideWinnersSuit = winnersIn(u);
  let quickWinnersTotal = 0;
  for (let uu = 0; uu < 4; uu++) quickWinnersTotal += winnersIn(uu);
  const winnersVsNeed = quickWinnersTotal - (declSide ? need : defNeed);
  const oppTrumpsPossible = pub.strain < 4 ? popcount(unseen[pub.strain]) + popcount(oppVis[pub.strain]) : 0;
  const sideTrumpsSeen = pub.strain < 4 ? popcount(sideVis[pub.strain]) : 0;
  // unseen cards in the candidate's suit sandwiched between two side cards
  // (finesse / tenace potential over an unseen honor)
  let tenaceOverUnseen = 0;
  {
    let m = unseen[u];
    while (m) {
      const rr = lowRank(m); m &= m - 1;
      const above = sideVis[u] & ~((2 << rr) - 1), below = sideVis[u] & ((1 << rr) - 1);
      if (above && below) tenaceOverUnseen++;
    }
    if (tenaceOverUnseen > 3) tenaceOverUnseen = 3;
  }
  // suits where the visible partner hand holds the top unplayed card (entries)
  let entriesPartner = 0;
  if (partnerVis) {
    for (let uu = 0; uu < 4; uu++) {
      const rem = FULL13 & ~pub.played[uu];
      if (rem && (partnerVis[uu] & (1 << highRank(rem)))) entriesPartner++;
    }
  }
  // is the candidate the cheapest card in hand that wins the trick as it stands?
  let cheapestWinner = 0;
  if (wouldWinNow && tl > 0) {
    cheapestWinner = 1;
    let m = hSeat[u] & ((1 << r) - 1);
    while (m && cheapestWinner) {
      const rr = lowRank(m); m &= m - 1;
      const tc2 = pub.tc.slice(); tc2[tl] = u * 13 + rr;
      if (trickWinnerPos(tc2, tl + 1, pub.strain) === tl) cheapestWinner = 0;
    }
  }
  const oppVoidInSuit = ((pub.voids[opp1] | pub.voids[opp2]) >> u) & 1;
  const partnerVoidInSuit = (pub.voids[(seat + 2) & 3] >> u) & 1;
  // every remaining card of the suit outside the side's visible hands is lower
  // than the side's lowest remaining card
  let suitEstablished = 0;
  {
    const others = unseen[u] | oppVis[u];
    if (sideVis[u] && (!others || highRank(others) < lowRank(sideVis[u]))) suitEstablished = 1;
  }
  const honorsOwnSuit = popcount(hSeat[u] & 0x1f00); // A K Q J T
  const underPartnerWinner = partnerWinning && !wouldWinNow ? 1 : 0;

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
    sideWinnersSuit, quickWinnersTotal, winnersVsNeed, oppTrumpsPossible,
    sideTrumpsSeen, tenaceOverUnseen, entriesPartner, cheapestWinner,
    tl === 1 ? 1 : 0, tl === 2 ? 1 : 0, tl === 3 ? 1 : 0, oppVoidInSuit, partnerVoidInSuit,
    suitEstablished, honorsOwnSuit, underPartnerWinner,
  ];
}

/** Forward pass of the trained scorer: feat -> standardized -> tanh(H1) ->
 *  tanh(H2) -> logit of P(contract makes). Monotone in the probability, so
 *  argmax/argmin on the logit is argmax/argmin on P(make). Pure function of
 *  the weights and the (lawful) features. */
export function makeScorer(W) {
  const D = W.D, H1 = W.H1, H2 = W.H2;
  const mu = W.mu, sd = W.sd, W1 = W.W1, b1 = W.b1, W2 = W.W2, b2 = W.b2, W3 = W.W3, b3 = W.b3;
  const x = new Float64Array(D), h1 = new Float64Array(H1), h2 = new Float64Array(H2);
  return (feat) => {
    for (let j = 0; j < D; j++) x[j] = (feat[j] - mu[j]) / sd[j];
    for (let i = 0; i < H1; i++) { let s = b1[i]; const o = i * D; for (let j = 0; j < D; j++) s += W1[o + j] * x[j]; h1[i] = Math.tanh(s); }
    for (let i = 0; i < H2; i++) { let s = b2[i]; const o = i * H1; for (let j = 0; j < H1; j++) s += W2[o + j] * h1[j]; h2[i] = Math.tanh(s); }
    let z = b3; for (let j = 0; j < H2; j++) z += W3[j] * h2[j];
    return z;
  };
}
