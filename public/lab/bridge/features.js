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
