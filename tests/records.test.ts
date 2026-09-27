/**
 * Player records (docs-data-model.md): the hand journal lines up with the
 * replay, abandoned and pre-recording hands are kept, Walt is stamped by
 * content address, and hints never reach a stat.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fixtures from './fixtures/nello.json';
import manifest from '../src/ai/phone/manifest.json';
import { applyAction, newDealtGame, PLUNGE_CONFIG, type GameState } from '../src/engine';
import { decodeReplay } from '../src/engine/replay-code';
import { idOfTile } from '../src/ai/walt/requests';
import type { NativeReceipt } from '../src/ai/native';
import { WALT_ID } from '../src/ai/walt-identity';
import type { HintEvidence } from '../src/questions/hint-evidence';
import { canonicalJson } from '../src/records/canonical';
import { closeJournal, finished, openJournal, withAction, type JournalContext } from '../src/records/journal';
import { scored, validHand, type HandRecord } from '../src/records/model';
import { aggregate } from '../src/stats/aggregate';
import { ANALYSIS_PROFILE } from '../src/stats/analysis';
import { handSteps } from '../src/stats/replay';
import { initialApp, loadApp, toSaved, type AppState, type Settings, type StorageLike } from '../src/ui/store';
import { chooseAction } from '../src/ai';
import { mulberry32 } from '../src/engine';
import { TEST_WALT, playRecorded, recorder } from './record-fixtures';

const moveHint = (choice: number): HintEvidence => ({ kind: 'move', requested_worlds: 40, choice, forced: false,
  estimate: null, explanation: 'fixture', context: 'fixture' });
const NELLO_SETTINGS: Settings = { difficulty: 'native-partner', preset: 'tournament', thinkDeeper: false, nelloPreview: true, showHints: true };

describe('Walt identity', () => {
  it('is the sha256 of the canonical pinned manifest, whatever its key order', () => {
    expect(WALT_ID).toBe(createHash('sha256').update(canonicalJson(manifest)).digest('hex'));
    const reversed = Object.fromEntries(Object.entries(manifest).reverse());
    expect(canonicalJson(reversed)).toBe(canonicalJson(manifest));
    const otherBinary = { ...manifest, wasm_sha256: '0'.repeat(64) };
    expect(createHash('sha256').update(canonicalJson(otherBinary)).digest('hex')).not.toBe(WALT_ID);
  });
});

describe('hand journal', () => {
  const { records } = playRecorded('records-journal');

  it('records every hand with one timed entry per replay action, attributed to its seat', () => {
    expect(records.length).toBeGreaterThan(1);
    for (const r of records) {
      expect(validHand(r)).toBe(r);
      expect(r.outcome).toBe('finished');
      const steps = handSteps(decodeReplay(r.code)!)!;
      expect(r.actions.length).toBe(steps.length);
      r.actions.forEach((a, i) => {
        expect(a.by).toBe(steps[i]!.state.turn === 0 ? 'person' : 'computer');
        expect(a.at).not.toBeNull();
        if (i > 0) expect(a.at!).toBeGreaterThan(r.actions[i - 1]!.at!);
      });
      expect(r.seats[0]).toEqual({ kind: 'person' });
      expect(r.seats[1]).toEqual({ kind: 'computer', player: 'easy', walt: null });
      expect(r.settings[0]).toMatchObject({ at: 0, difficulty: 'easy', hints: true });
    }
    expect(new Set(records.map(r => r.game.id)).size).toBe(1);
    expect(records.map(r => r.game.hand)).toEqual(records.map((_, i) => i + 1));
  });

  it('rejects a record whose timings, seats or outcome disagree with its replay', () => {
    const r = records[0]!;
    expect(() => validHand({ ...r, actions: r.actions.slice(1) })).toThrow(/timing/);
    expect(() => validHand({ ...r, actions: r.actions.map(a => ({ ...a, by: 'person' })) })).toThrow(/action/);
    expect(() => validHand({ ...r, outcome: 'abandoned' })).toThrow(/outcome/);
    expect(() => validHand({ ...r, code: `${r.code.slice(0, -2)}00` })).toThrow();
  });

  /** Deal until a hand is under way (a few plays in), clearing any earlier records. */
  function midHand(rec: ReturnType<typeof recorder>, seed: string): AppState {
    const rand = mulberry32(3);
    let s = rec.step(initialApp(null), { type: 'set-difficulty', difficulty: 'easy' });
    for (let k = 0; ; k++) {
      s = rec.step({ ...s, outbox: [] }, { type: 'new-game', seed: `${seed}-${k}`, sessionId: 'm' });
      while (!finished(s.game!) && !(s.game!.phase === 'playing' && s.game!.currentTrick.length >= 2)) {
        const g = s.game!;
        s = s.showTrick ? rec.step(s, { type: 'trick-shown' })
          : g.turn === 0 ? rec.step(s, { type: 'human', action: chooseAction(g, 0, 'easy', rand) })
          : rec.step(s, { type: 'ai', choose: (gg, seat) => chooseAction(gg, seat, 'easy', rand) });
      }
      if (!finished(s.game!)) return { ...s, outbox: [] };
    }
  }
  const finishHand = (rec: ReturnType<typeof recorder>, from: AppState): AppState => {
    const rand = mulberry32(9);
    let s = from;
    while (s.outbox.length === 0) {
      const g = s.game!;
      s = s.showTrick ? rec.step(s, { type: 'trick-shown' })
        : g.turn === 0 ? rec.step(s, { type: 'human', action: chooseAction(g, 0, 'easy', rand) })
        : rec.step(s, { type: 'ai', choose: (gg, seat) => chooseAction(gg, seat, 'easy', rand) });
    }
    return s;
  };

  it('keeps a hand abandoned by a new game, and skips a deal nobody acted on', () => {
    const rec = recorder();
    let s = rec.step(initialApp(null), { type: 'set-difficulty', difficulty: 'easy' });
    s = rec.step(s, { type: 'new-game', seed: 'untouched', sessionId: 'a' });
    s = rec.step(s, { type: 'new-game', seed: 'untouched-too', sessionId: 'b' });
    expect(s.outbox).toHaveLength(0);
    s = midHand(rec, 'abandon');
    const played = s.journal!.actions.length;
    s = rec.step(s, { type: 'new-game', seed: 'fresh', sessionId: 'c' });
    expect(s.outbox).toHaveLength(1);
    const abandoned = s.outbox[0]!;
    expect(validHand(abandoned)).toBe(abandoned);
    expect(abandoned.outcome).toBe('abandoned');
    expect(abandoned.actions).toHaveLength(played);
    expect(s.journal!.game.id).not.toBe(abandoned.game.id);
    // Abandoned hands stay in the log but have no outcome to count.
    expect(aggregate([scored(abandoned)], [], ANALYSIS_PROFILE).hands).toBe(0);
  });

  it('adopts a game saved before recording existed, keeping earlier actions with unknown times', () => {
    const rec = recorder();
    const before = midHand(rec, 'legacy');
    const earlier = before.journal!.actions.length;
    const r = finishHand(rec, { ...before, journal: null }).outbox[0]!;
    expect(validHand(r)).toBe(r);
    expect(r.actions.slice(0, earlier).every(a => a.at === null)).toBe(true);
    expect(r.actions.slice(earlier).every(a => a.at !== null)).toBe(true);
    expect(r.actions.length).toBeGreaterThan(earlier);
  });

  it('keeps a finished hand saved before recording existed, even when a new game comes first', () => {
    const rec = recorder();
    const done = finishHand(rec, midHand(rec, 'finished-legacy'));
    const expected = done.outbox[0]!;
    const legacy: AppState = { ...done, journal: null, outbox: [] };
    for (const e of [{ type: 'new-game', seed: 'next', sessionId: 'n' }, { type: 'human', action: { type: 'next-hand' } }] as const) {
      const after = rec.step(legacy, e);
      expect(after.outbox).toHaveLength(1);
      const r = after.outbox[0]!;
      expect(validHand(r)).toBe(r);
      expect(r.code).toBe(expected.code);
      expect(r.outcome).toBe('finished');
      expect(r.actions.every(a => a.at === null)).toBe(true);
    }
  });

  it('persists the open journal and the outbox with the saved game', () => {
    const { state } = playRecorded('records-persist', 1);
    const store = new Map<string, string>();
    const storage: StorageLike = { getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k) };
    // Only computer-player saves are restored; the recording travels with them.
    storage.setItem('plunge:save:v1', JSON.stringify(toSaved({ ...state, settings: { ...state.settings, difficulty: 'native-partner' } })));
    const loaded = initialApp(loadApp(storage));
    expect(loaded.outbox).toEqual(state.outbox);
    expect(loaded.journal).toEqual(state.journal);
  });
});

describe('Walt stamping', () => {
  it('names the build and effort behind each computer move, sharing repeated profiles', () => {
    const f = fixtures[0]!;
    const deal = decodeReplay(f.replay)!;
    let n = 0;
    const ctx: JournalContext = { now: 1000, app: 'test', walt: TEST_WALT, newId: () => (++n).toString(16).padStart(32, '0') };
    let j = openJournal(newDealtGame(PLUNGE_CONFIG, deal.dealt, deal.shaker), { id: '9'.repeat(32), seed: 's' }, NELLO_SETTINGS, ctx);
    const receipt = (id: string) => ({ id, identity: { player: { name: 'l1-default' } },
      response: { n: 40, budget_ms: 14000, mode: 'ordinary', counterexample_result: { rounds: 3 } } }) as unknown as NativeReceipt;
    j = withAction(j, 1100, TEST_WALT, { kind: 'native', receipt: receipt('a'.repeat(64)) });
    j = withAction(j, 1200, TEST_WALT, { kind: 'native', receipt: receipt('b'.repeat(64)) });
    j = withAction(j, 1300, TEST_WALT, { kind: 'heuristic', player: 'easy' });
    expect(j.seats[1]).toEqual({ kind: 'computer', player: 'native-partner', walt: TEST_WALT });
    expect(j.profiles).toEqual([
      { source: 'play', player: 'l1-default', walt: TEST_WALT, worlds: 40, budgetMs: 14000, mode: 'ordinary', counterexamples: true },
      { source: 'heuristic', player: 'easy', walt: null, worlds: null, budgetMs: null, mode: null, counterexamples: false },
    ]);
    expect(j.actions.map(a => [a.profile, a.receipt])).toEqual([[0, 'a'.repeat(64)], [0, 'b'.repeat(64)], [1, undefined]]);
  });
});

/** A human-called Nel-O hand from the shared fixtures, recorded through the journal. */
function nelloRecord(f: typeof fixtures[number]): HandRecord {
  const deal = decodeReplay(f.replay)!;
  let n = 0, now = 5000;
  const ctx = (): JournalContext => ({ now, app: 'test', walt: TEST_WALT, newId: () => (++n).toString(16).padStart(32, '0') });
  let g: GameState = newDealtGame(PLUNGE_CONFIG, deal.dealt, deal.shaker);
  let j = openJournal(g, { id: 'e'.repeat(32), seed: 'nello' }, NELLO_SETTINGS, ctx());
  const act = (a: Parameters<typeof applyAction>[1]) => {
    const person = g.turn === 0;
    g = applyAction(g, a); now += 300;
    j = withAction(j, now, TEST_WALT, person ? undefined : { kind: 'heuristic', player: 'fixture' });
  };
  act({ type: 'bid', bid: { kind: 'marks', value: 1 } });
  for (let i = 0; i < 3; i++) act({ type: 'bid', bid: { kind: 'pass' } });
  act({ type: 'declare', decl: { type: 'nello' } });
  for (let p = 0; p < f.plays.length; p += 2) act({ type: 'play', domino: idOfTile(f.plays[p + 1]!) });
  return closeJournal(j, g, 'finished', ctx()).record!;
}

describe('Nel-O hands', () => {
  it('record under their own rules and count for marks, never for count, sweeps or partner play', () => {
    const hands = fixtures.filter(f => f.declarer === 0).map(nelloRecord);
    for (const r of hands) {
      expect(validHand(r)).toBe(r);
      expect(decodeReplay(r.code)!.contract?.kind).toBe('nello');
    }
    const report = aggregate(hands.map(scored), [], ANALYSIS_PROFILE);
    expect(report.hands).toBe(hands.length);
    expect(report.decided).toBe(hands.length);
    expect(report.marks.us + report.marks.them).toBeGreaterThan(0);
    expect(report.bidding.byTrump.map(l => l.label)).toEqual(['Nel-O']);
    expect(report.count).toEqual({ captured: 0, decided: 0 });
    expect(report.sweeps).toEqual({ us: 0, them: 0 });
    expect(report.partner).toEqual({ assists: 0, assistPoints: 0, saves: 0, savePoints: 0, gifts: 0, giftPoints: 0 });
  });
});

describe('hints are kept but never scored', () => {
  // Show a hint before every one of the person's decisions in the whole game.
  const hinted = playRecorded('records-hints', Infinity, s =>
    s.game!.turn === 0 && s.game!.phase === 'playing' ? { type: 'hint-shown', evidence: moveHint(0) } : null).records;
  const plain = playRecorded('records-hints').records;

  it('keeps each displayed hint with the hand, placed before the action it preceded', () => {
    const events = hinted.flatMap(r => r.assist.map(e => ({ e, r })));
    expect(events.length).toBeGreaterThan(10);
    for (const { e, r } of events) {
      expect(e.before).toBeLessThan(r.actions.length);
      expect(r.actions[e.before]!.by).toBe('person');
      expect(e.evidence).toEqual(moveHint(0));
    }
  });

  it('removes hints, the hints switch and timings from what stats can read', () => {
    for (const r of hinted) expect(Object.keys(scored(r)).sort()).toEqual(['code', 'ended', 'game', 'id', 'marksBefore', 'outcome', 'seats']);
  });

  it('gives identical stats with or without hints, with the switch on or off', () => {
    // Same seed and policy: the games are identical except for the hint events.
    expect(hinted.map(r => r.code)).toEqual(plain.map(r => r.code));
    const off = hinted.map(r => ({ ...r, assist: [], settings: r.settings.map(s => ({ ...s, hints: false })) }));
    const views = [hinted, plain, off].map(rs => aggregate(rs.map(scored), [], ANALYSIS_PROFILE));
    expect(views[0]).toEqual(views[1]);
    expect(views[0]).toEqual(views[2]);
    expect(hinted.map(scored).map(h => ({ ...h, ended: '' }))).toEqual(plain.map(scored).map(h => ({ ...h, ended: '' })));
  });
});
