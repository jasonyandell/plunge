/**
 * Pure aggregation over the hand log. Everything is derived by replaying the
 * recorded codes through the engine, so a corrupt record simply drops out and
 * new statistics apply to the whole history.
 *
 * "Agreed with Walt" for bids and trump calls is computed here, silently and
 * retroactively, from the same read-only book lookup the in-game hint uses —
 * it measures the decision you made, never whether you looked at a hint.
 */
import {
  type Bid,
  type Declaration,
  type GameState,
  countValue,
  fromId,
  teamOf,
} from '../engine';
import { decodeReplay } from '../engine/replay-code';
import { getBiddingHint } from '../ai/bidding-hint';
import type { HandAnalysis, HandRecord } from './log';
import { handSteps } from './replay';

export interface DecodedHand {
  readonly record: HandRecord;
  readonly game: GameState;
}

export interface BidLine {
  readonly label: string;
  bids: number;
  made: number;
}

export interface Disagreement {
  readonly id: string;
  readonly code: string;
  readonly handNumber: number;
  readonly ply: number;
  readonly played: number;
  readonly suggested: number;
  readonly gap: number;
  readonly objective: 'make' | 'set';
}

interface PlyBucket {
  readonly label: string;
  decisions: number;
  matches: number;
  regretSum: number;
}

export interface StatsReport {
  readonly hands: number;
  decided: number;
  thrownIn: number;
  readonly games: { played: number; won: number; current: number; best: number };
  readonly marks: { us: number; them: number };
  handsWon: number;
  readonly bidding: {
    readonly yours: { bids: number; made: number; forced: number; forcedMade: number };
    readonly byBid: readonly BidLine[];
    readonly byTrump: readonly BidLine[];
    readonly team: { bids: number; made: number };
    readonly defense: { hands: number; sets: number };
  };
  readonly partner: {
    assists: number; assistPoints: number;
    saves: number; savePoints: number;
    gifts: number; giftPoints: number;
  };
  readonly count: { captured: number; decided: number };
  readonly sweeps: { us: number; them: number };
  readonly agreement: {
    readonly bids: { considered: number; agreed: number };
    readonly trump: { considered: number; agreed: number };
    readonly whenAgreed: { hands: number; won: number };
    readonly whenNot: { hands: number; won: number };
    readonly phi: number | null;
  };
  readonly play: {
    analyzed: number; pending: number; unsupported: number;
    decisions: number; matches: number; defensible: number; forced: number;
    regretSum: number;
    readonly disagreements: readonly Disagreement[];
    readonly byStage: readonly PlyBucket[];
    readonly declaring: PlyBucket;
    readonly defending: PlyBucket;
  };
}

/** A played tile within this band of Walt's best estimate reads as a tie, not a mistake. */
export const DEFENSIBLE_BAND = 0.05;

export const PIP_NAMES: readonly string[] = [
  'blanks', 'aces', 'deuces', 'treys', 'fours', 'fives', 'sixes',
];

export function trumpName(d: Declaration): string {
  switch (d.type) {
    case 'pip': return PIP_NAMES[d.pip] ?? String(d.pip);
    case 'doubles': return 'doubles';
    case 'no-trump': return 'follow me';
    case 'nello': return 'Nel-O';
    case 'sevens': return 'sevens';
  }
}

function bidBucket(bid: Bid): string {
  if (bid.kind !== 'points') return 'Marks';
  return bid.value <= 31 ? '30–31' : bid.value <= 35 ? '32–35' : '36–41';
}

const bidEq = (a: Bid, b: Bid): boolean =>
  a.kind === b.kind && (a.kind === 'pass' || a.value === (b as { value: number }).value)
  && (a.kind !== 'marks' || a.special === (b as { special?: string }).special);

const declEq = (a: Declaration, b: Declaration): boolean =>
  a.type === b.type && (a.type !== 'pip' || a.pip === (b as { pip: number }).pip);

/** Replay every record; anything the engine refuses drops out. */
export function decodeRecords(records: readonly HandRecord[]): DecodedHand[] {
  const out: DecodedHand[] = [];
  for (const record of records) {
    const game = decodeReplay(record.code);
    if (game) out.push({ record, game });
  }
  return out;
}

function line(lines: BidLine[], label: string, made: boolean): void {
  const found = lines.find((l) => l.label === label) ?? lines[lines.push({ label, bids: 0, made: 0 }) - 1]!;
  found.bids++;
  if (made) found.made++;
}

function bucket(b: PlyBucket, match: boolean, regret: number): void {
  b.decisions++;
  if (match) b.matches++;
  b.regretSum += regret;
}

export function aggregate(
  records: readonly HandRecord[],
  analyses: readonly HandAnalysis[],
  profile: string,
): StatsReport {
  const hands = decodeRecords(records);
  const byId = new Map(hands.map((h) => [h.record.id, h]));
  const analysisById = new Map(analyses.filter((a) => a.profile === profile && byId.has(a.id)).map((a) => [a.id, a]));

  // ---- games, marks, hand outcomes ----------------------------------------
  const finals = hands.filter((h) => h.record.gameOver)
    .sort((a, b) => a.record.endedAt.localeCompare(b.record.endedAt));
  const gameWins = finals.map((h) => h.record.marksAfter[0] > h.record.marksAfter[1]);
  let best = 0, run = 0;
  for (const won of gameWins) { run = won ? run + 1 : 0; best = Math.max(best, run); }
  let current = 0;
  for (let i = gameWins.length - 1; i >= 0 && gameWins[i] === gameWins[gameWins.length - 1]; i--) {
    current += gameWins[i] ? 1 : -1;
  }

  const report: StatsReport = {
    hands: hands.length,
    decided: 0,
    thrownIn: 0,
    games: { played: finals.length, won: gameWins.filter(Boolean).length, current, best },
    marks: { us: 0, them: 0 },
    handsWon: 0,
    bidding: {
      yours: { bids: 0, made: 0, forced: 0, forcedMade: 0 },
      byBid: [], byTrump: [],
      team: { bids: 0, made: 0 },
      defense: { hands: 0, sets: 0 },
    },
    partner: { assists: 0, assistPoints: 0, saves: 0, savePoints: 0, gifts: 0, giftPoints: 0 },
    count: { captured: 0, decided: 0 },
    sweeps: { us: 0, them: 0 },
    agreement: {
      bids: { considered: 0, agreed: 0 },
      trump: { considered: 0, agreed: 0 },
      whenAgreed: { hands: 0, won: 0 },
      whenNot: { hands: 0, won: 0 },
      phi: null,
    },
    play: {
      analyzed: 0, pending: 0, unsupported: 0,
      decisions: 0, matches: 0, defensible: 0, forced: 0,
      regretSum: 0,
      disagreements: [],
      byStage: [
        { label: 'Tricks 1–2', decisions: 0, matches: 0, regretSum: 0 },
        { label: 'Tricks 3–5', decisions: 0, matches: 0, regretSum: 0 },
        { label: 'Tricks 6–7', decisions: 0, matches: 0, regretSum: 0 },
      ],
      declaring: { label: 'Declaring', decisions: 0, matches: 0, regretSum: 0 },
      defending: { label: 'Defending', decisions: 0, matches: 0, regretSum: 0 },
    },
  };
  const disagreements: Disagreement[] = [];

  for (const { record, game: g } of hands) {
    const result = g.handResult;
    if (g.thrownIn) report.thrownIn++;
    if (result) {
      report.decided++;
      const usWon = result.team === 0;
      if (usWon) { report.handsWon++; report.marks.us += result.marks; }
      else report.marks.them += result.marks;

      const declTeam = teamOf(result.declarer);
      if (declTeam === 0) {
        report.bidding.team.bids++;
        if (result.made) report.bidding.team.made++;
      } else {
        report.bidding.defense.hands++;
        if (!result.made) report.bidding.defense.sets++;
      }
      if (result.declarer === 0) {
        const yours = report.bidding.yours;
        yours.bids++;
        if (result.made) yours.made++;
        if (g.forcedBid) { yours.forced++; if (result.made) yours.forcedMade++; }
        const winning = g.bids.find((b) => b.seat === 0)?.bid;
        if (winning) line(report.bidding.byBid as BidLine[], bidBucket(winning), result.made);
        if (g.declaration) line(report.bidding.byTrump as BidLine[], trumpName(g.declaration), result.made);
      }
      if (g.tricks.length === 7 && g.tricks.every((t) => teamOf(t.winner) === teamOf(g.tricks[0]!.winner))) {
        if (teamOf(g.tricks[0]!.winner) === 0) report.sweeps.us++;
        else report.sweeps.them++;
      }
    }

    // ---- trick-level: assists, saves, gifts, count capture ----------------
    for (const t of g.tricks) {
      const trickCount = t.points - 1;
      report.count.decided += trickCount;
      if (teamOf(t.winner) === 0) report.count.captured += trickCount;
      const mine = t.plays.find((p) => p.seat === 0);
      const myCount = mine ? countValue(fromId(mine.domino)) : 0;
      if (t.winner === 2 && myCount > 0) { report.partner.assists++; report.partner.assistPoints += myCount; }
      if (teamOf(t.winner) === 1 && myCount > 0) { report.partner.gifts++; report.partner.giftPoints += myCount; }
      if (t.winner === 0) {
        const theirs = t.plays.reduce((sum, p) => sum + (teamOf(p.seat) === 1 ? countValue(fromId(p.domino)) : 0), 0);
        if (theirs > 0) { report.partner.saves++; report.partner.savePoints += theirs; }
      }
    }

    // ---- silent bid/trump agreement (book lookup, unbiased) ---------------
    const steps = handSteps(g);
    let bidVerdict: boolean | null = null;
    if (steps) {
      for (const { state, action } of steps) {
        if (state.turn !== 0 || (action.type !== 'bid' && action.type !== 'declare')) continue;
        try {
          const hint = getBiddingHint(state);
          if (hint.kind !== 'book') continue;
          if (action.type === 'bid' && hint.action.type === 'bid') {
            bidVerdict = bidEq(action.bid, hint.action.bid);
            report.agreement.bids.considered++;
            if (bidVerdict) report.agreement.bids.agreed++;
          } else if (action.type === 'declare' && hint.action.type === 'declare') {
            report.agreement.trump.considered++;
            if (declEq(action.decl, hint.action.decl)) report.agreement.trump.agreed++;
          }
        } catch { /* not a hintable turn — leave it out of the denominator */ }
      }
    }
    if (bidVerdict !== null && result) {
      const group = bidVerdict ? report.agreement.whenAgreed : report.agreement.whenNot;
      group.hands++;
      if (result.team === 0) group.won++;
    }

    // ---- Walt's play review (from the derived cache) -----------------------
    const analysis = analysisById.get(record.id);
    if (!analysis) {
      if (result) report.play.pending++;
      continue;
    }
    if (analysis.unsupported) { report.play.unsupported++; continue; }
    report.play.analyzed++;
    const declaring = g.declarer !== null && teamOf(g.declarer) === 0;
    for (const v of analysis.plies) {
      if (v.forced) { report.play.forced++; continue; }
      if (v.playedChance === null || v.bestChance === null) continue;
      const gap = Math.max(0, v.bestChance - v.playedChance);
      report.play.decisions++;
      if (v.playedBest) report.play.matches++;
      if (gap <= DEFENSIBLE_BAND) report.play.defensible++;
      report.play.regretSum += gap;
      const stage = report.play.byStage[Math.min(2, v.ply < 8 ? 0 : v.ply < 20 ? 1 : 2)]!;
      bucket(stage, v.playedBest, gap);
      bucket(declaring ? report.play.declaring : report.play.defending, v.playedBest, gap);
      if (!v.playedBest && v.suggested !== null && gap > DEFENSIBLE_BAND) {
        disagreements.push({
          id: record.id, code: record.code, handNumber: record.handNumber, ply: v.ply,
          played: v.played, suggested: v.suggested, gap,
          objective: declaring ? 'make' : 'set',
        });
      }
    }
  }

  // ---- agreement ↔ winning: phi over the 2×2 -------------------------------
  const a = report.agreement;
  const n11 = a.whenAgreed.won, n10 = a.whenAgreed.hands - a.whenAgreed.won;
  const n01 = a.whenNot.won, n00 = a.whenNot.hands - a.whenNot.won;
  const denom = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
  (a as { phi: number | null }).phi = denom > 0 ? (n11 * n00 - n10 * n01) / denom : null;

  disagreements.sort((x, y) => y.gap - x.gap);
  (report.play as { disagreements: readonly Disagreement[] }).disagreements = disagreements.slice(0, 10);
  return report;
}
