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
// The featurizer moved to public/lab/bridge/features.js (shared verbatim with
// the in-search scorer mind, so training and inference cannot drift).
import { featurize, FEATURE_NAMES } from '../../../public/lab/bridge/features.js';
export { FEATURE_NAMES };

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
