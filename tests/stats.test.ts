/**
 * Local stats: the append-only hand log, the pure aggregation over recorded
 * replays, and the deterministic sample slate. IndexedDB via fake-indexeddb;
 * hand data comes from real engine playouts, never hand-built literals.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import { applyAction, countValue, fromId, legalActions, newGame, teamOf, PLUNGE_CONFIG, type GameState } from '../src/engine';
import { decodeReplay } from '../src/engine/replay-code';
import { chooseAction } from '../src/ai';
import { appendHand, handRecordOf, listAnalyses, listHands, putAnalysis, type HandRecord } from '../src/stats/log';
import { aggregate, decodeRecords } from '../src/stats/aggregate';
import { handSteps } from '../src/stats/replay';
import { ANALYSIS_PROFILE } from '../src/stats/analysis';
import { sampleData } from '../src/stats/sample';
import { GameOverSheet } from '../src/ui/sheets';
import { reducer, initialApp, type AppEvent } from '../src/ui/store';
import { mulberry32 } from '../src/engine';

/** Play one full game with the cheap legal policy; capture like App.tsx would. */
function playRecordedGame(seed: string, gameId: string): HandRecord[] {
  let g: GameState = newGame(PLUNGE_CONFIG, seed);
  const rand = mulberry32(7);
  const records: HandRecord[] = [];
  for (let guard = 0; guard < 5000; guard++) {
    if (g.phase === 'hand-over' || g.phase === 'game-over') {
      const record = handRecordOf(g, gameId, 'easy');
      expect(record).not.toBeNull();
      records.push(record!);
      if (g.phase === 'game-over') return records;
      g = applyAction(g, { type: 'next-hand' });
      continue;
    }
    g = applyAction(g, chooseAction(g, g.turn!, 'easy', rand));
  }
  throw new Error('game never finished');
}

describe('hand log', () => {
  it('records only finished hands, appends once, and lists in play order', async () => {
    const records = playRecordedGame('stats-log', 'game-a');
    expect(handRecordOf(newGame(PLUNGE_CONFIG, 'mid'), 'game-a', 'easy')).toBeNull();
    expect(handRecordOf(decodeReplay(records[0]!.code)!, 'bad id!', 'easy')).toBeNull();
    for (const r of records) await appendHand(r);
    await appendHand({ ...records[0]!, player: 'tampered' }); // dedup keeps the original
    const listed = await listHands();
    expect(listed.length).toBe(records.length);
    expect(listed[0]!.player).toBe('easy');
    expect(listed.map((r) => r.id)).toEqual(records.map((r) => r.id));
    expect(new Set(listed.map((r) => r.id)).size).toBe(records.length);
    const last = listed[listed.length - 1]!;
    expect(last.gameOver).toBe(true);
    expect(Math.max(...last.marksAfter)).toBeGreaterThanOrEqual(7);
    // Every record replays through the engine and marks stay consistent.
    for (const r of listed) {
      const g = decodeReplay(r.code)!;
      expect(g).not.toBeNull();
      const awarded = g.handResult ? g.handResult.marks : 0;
      expect((r.marksAfter[0] + r.marksAfter[1]) - (r.marksBefore[0] + r.marksBefore[1])).toBe(awarded);
    }
    // The analysis cache is a separate, overwritable store.
    await putAnalysis({ schema: 'plunge-hand-analysis-v1', id: last.id, profile: ANALYSIS_PROFILE, plies: [], unsupported: false });
    await putAnalysis({ schema: 'plunge-hand-analysis-v1', id: last.id, profile: ANALYSIS_PROFILE, plies: [], unsupported: true });
    const analyses = await listAnalyses();
    expect(analyses.length).toBe(1);
    expect(analyses[0]!.unsupported).toBe(true);
  });
});

describe('replay walk', () => {
  it('re-simulates every recorded decision with the position it was made from', () => {
    const record = playRecordedGame('stats-walk', 'game-b').find((r) => !r.thrownIn)!;
    const g = decodeReplay(record.code)!;
    const steps = handSteps(g)!;
    expect(steps).not.toBeNull();
    expect(steps.length).toBe(g.bids.length + (g.declaration ? 1 : 0) + g.tricks.reduce((n, t) => n + t.plays.length, 0));
    for (const { state, action } of steps) {
      expect(JSON.stringify(legalActions(state))).toContain(JSON.stringify(action));
    }
    expect(handSteps({ ...g, points: [41, 1] })).toBeNull();
  });
});

describe('aggregate', () => {
  const sample = sampleData();
  const report = aggregate(sample.hands, sample.analyses, ANALYSIS_PROFILE);

  it('is a real slate: full games on catalogued deals, decoded by the engine', () => {
    expect(sample.hands.length).toBeGreaterThan(30);
    expect(decodeRecords(sample.hands).length).toBe(sample.hands.length);
    expect(report.hands).toBe(sample.hands.length);
    expect(report.games.played).toBe(8);
    expect(sampleData().hands).toBe(sample.hands); // memoized
  });

  it('keeps the books balanced', () => {
    expect(report.decided + report.thrownIn).toBe(report.hands);
    expect(report.bidding.team.bids + report.bidding.defense.hands).toBe(report.decided);
    expect(report.bidding.yours.bids).toBeLessThanOrEqual(report.bidding.team.bids);
    expect(report.bidding.yours.made).toBeLessThanOrEqual(report.bidding.yours.bids);
    expect(report.games.won).toBeLessThanOrEqual(report.games.played);
    expect(Math.abs(report.games.current)).toBeLessThanOrEqual(report.games.played);
    const byBid = report.bidding.byBid.reduce((n, l) => n + l.bids, 0);
    expect(byBid).toBe(report.bidding.yours.bids);
    for (const l of [...report.bidding.byBid, ...report.bidding.byTrump]) {
      expect(l.made).toBeLessThanOrEqual(l.bids);
    }
    // Count decided in play, re-derived independently from hand points.
    const decidedCount = decodeRecords(sample.hands).reduce(
      (n, { game }) => n + game.points[0] + game.points[1] - game.tricks.length, 0);
    expect(report.count.decided).toBe(decidedCount);
    expect(report.count.captured).toBeLessThanOrEqual(report.count.decided);
    // Assists/saves/gifts are count points, so multiples of five.
    for (const points of [report.partner.assistPoints, report.partner.savePoints, report.partner.giftPoints]) {
      expect(points % 5).toBe(0);
    }
    expect(report.marks.us + report.marks.them).toBeGreaterThanOrEqual(report.decided);
  });

  it('scores bid and trump agreement from the book, and correlates with wins', () => {
    const a = report.agreement;
    expect(a.bids.considered).toBeGreaterThan(0);
    expect(a.bids.agreed).toBeLessThanOrEqual(a.bids.considered);
    expect(a.trump.agreed).toBeLessThanOrEqual(a.trump.considered);
    expect(a.whenAgreed.hands + a.whenNot.hands).toBeLessThanOrEqual(report.decided);
    if (a.phi !== null) {
      expect(a.phi).toBeGreaterThanOrEqual(-1);
      expect(a.phi).toBeLessThanOrEqual(1);
    }
  });

  it('folds Walt reviews in: matches, the defensible band, regret and disagreements', () => {
    const p = report.play;
    expect(p.analyzed).toBeGreaterThan(0);
    expect(p.pending).toBe(0);
    expect(p.decisions).toBeGreaterThan(0);
    expect(p.matches).toBeLessThanOrEqual(p.defensible); // best is within any band
    expect(p.defensible).toBeLessThanOrEqual(p.decisions);
    expect(p.regretSum).toBeGreaterThan(0);
    expect(p.byStage.reduce((n, s) => n + s.decisions, 0)).toBe(p.decisions);
    expect(p.declaring.decisions + p.defending.decisions).toBe(p.decisions);
    expect(p.disagreements.length).toBeGreaterThan(0);
    expect(p.disagreements.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < p.disagreements.length; i++) {
      expect(p.disagreements[i]!.gap).toBeLessThanOrEqual(p.disagreements[i - 1]!.gap);
    }
    for (const d of p.disagreements) {
      expect(d.suggested).not.toBe(d.played);
      expect(decodeReplay(d.code)).not.toBeNull();
    }
    // A stale profile leaves the review section pending, never wrong.
    const stale = aggregate(sample.hands, sample.analyses, 'some-newer-profile');
    expect(stale.play.decisions).toBe(0);
    expect(stale.play.pending).toBeGreaterThan(0);
  });

  it('re-derives partner play from the tricks of a known hand', () => {
    const { record, game } = decodeRecords(sample.hands)[0]!;
    const one = aggregate([record], [], ANALYSIS_PROFILE);
    let assistPoints = 0, giftPoints = 0;
    for (const t of game.tricks) {
      const mine = t.plays.find((p) => p.seat === 0);
      const v = mine ? countValue(fromId(mine.domino)) : 0;
      if (t.winner === 2) assistPoints += v;
      if (teamOf(t.winner) === 1) giftPoints += v;
    }
    expect(one.partner.assistPoints).toBe(assistPoints);
    expect(one.partner.giftPoints).toBe(giftPoints);
  });

  it('drops records the engine refuses instead of poisoning the averages', () => {
    const broken = { ...sample.hands[0]!, id: 'broken:1', code: `${sample.hands[0]!.code.slice(0, -2)}00` };
    const r = aggregate([...sample.hands, broken], sample.analyses, ANALYSIS_PROFILE);
    expect(r.hands).toBe(sample.hands.length);
  });
});

describe('game identity', () => {
  it('play-again deals a fresh uuid session so games never merge in the log', () => {
    const over = { winner: 0, marks: [7, 3], handNumber: 9 } as unknown as GameState;
    const events: AppEvent[] = [];
    const v = GameOverSheet({ g: over, dispatch: (e) => events.push(e) }) as VNode;
    const buttons: { children: unknown; onClick?: () => void }[] = [];
    (function walk(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      const n = node as VNode & { props?: { children?: unknown; onClick?: () => void } };
      if (n.type === 'button' && n.props?.onClick) buttons.push({ children: n.props.children, onClick: n.props.onClick });
      const kids = n.props?.children;
      for (const k of Array.isArray(kids) ? kids : [kids]) walk(k);
    })(v);
    buttons.find((b) => String(b.children) === 'Play again')!.onClick!();
    const e = events[0] as { type: string; sessionId?: string };
    expect(e.type).toBe('new-game');
    expect(e.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("routes to the stats screen and back", () => {
    const app = reducer(initialApp(null), { type: 'go', screen: 'stats' });
    expect(app.screen).toBe('stats');
    expect(reducer(app, { type: 'go', screen: 'home' }).screen).toBe('home');
  });
});
