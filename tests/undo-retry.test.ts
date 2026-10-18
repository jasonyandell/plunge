/**
 * Undo and "Play this hand again": rollback semantics, stale-response
 * rejection, saves, and append-only history/stats provenance.
 */
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import { type Action, type GameState, LEGACY_PLUNGE_CONFIG, PLUNGE_CONFIG, TOURNAMENT_CONFIG, legalActions, legalDominoes } from '../src/engine';
import {
  type AppState, type ChooseFn, type SavedState, DEFAULT_SETTINGS, HUMAN_SEAT,
  type AppEvent, canRestart, canUndo, handStartOf, liveDispatch, initialApp, loadApp, pendingAiSeat, questionGameId, reducer, saveApp, toSaved,
} from '../src/ui/store';
import { auctionKey } from '../src/ai/auction';
import { requestOf, type NativeReceipt } from '../src/ai/native';
import { tileOfId } from '../src/ai/walt/requests';
import { listHistory, recordHistory, snapshotOf, exportHistory } from '../src/history/recorder';
import { listHands } from '../src/history/legacy';
import { encodeReplay } from '../src/engine/replay-code';
import { attachGame, saveQuestion } from '../src/questions/client';
import { listQuestions } from '../src/questions/storage';
import { DeclareSheet, GameOverSheet, HandOverSheet, RestartConfirm } from '../src/ui/sheets';
import { Home } from '../src/ui/Home';

beforeAll(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

/** Computer seats pass when they may and otherwise take their first legal option. */
const cheap: ChooseFn = (g) => legalActions(g)[0]!;

/** Bid 30 when possible, call the first trump, play the `pick`-th legal domino. */
function yours(g: GameState, pick = 0): Action {
  const actions = legalActions(g);
  if (g.phase === 'bidding') return actions.find((a) => a.type === 'bid' && a.bid.kind === 'points') ?? actions[0]!;
  if (g.phase === 'playing') return actions[Math.min(pick, actions.length - 1)]!;
  return actions[0]!;
}

/** Run computer seats and the trick pause until you're up (or the hand is over). */
function untilYou(app: AppState): AppState {
  for (let i = 0; i < 200; i++) {
    if (pendingAiSeat(app) !== null) app = reducer(app, { type: 'ai', choose: cheap });
    else if (app.showTrick) app = reducer(app, { type: 'trick-shown' });
    else return app;
  }
  throw new Error('stuck');
}

function you(app: AppState, pick = 0): AppState {
  const next = reducer(app, { type: 'human', action: yours(app.game!, pick) });
  expect(next.game).not.toBe(app.game);
  return next;
}

function toHandEnd(app: AppState, pick = 0): AppState {
  for (let i = 0; i < 100; i++) {
    app = untilYou(app);
    const g = app.game!;
    if (g.phase === 'hand-over' || g.phase === 'game-over') return app;
    app = you(app, pick);
  }
  throw new Error('hand never ended');
}

function start(seed: string, sessionId = `undo-${seed}`): AppState {
  return reducer(initialApp(null), { type: 'new-game', seed, sessionId });
}

/** A deal where your bid comes before at least one computer seat's. */
function dealWhereOthersBidAfterYou(): AppState {
  for (let i = 0; i < 40; i++) {
    const app = start(`after-${i}`);
    if (app.game!.shaker !== HUMAN_SEAT) return app;
  }
  throw new Error('no deal');
}

const plays = (g: GameState) => g.tricks.reduce((n, t) => n + t.plays.length, 0) + g.currentTrick.length;

describe('undo', () => {
  it('takes back your bid together with the computer bids that followed', () => {
    const before = untilYou(dealWhereOthersBidAfterYou());
    const after = untilYou(you(before));
    expect(after.game!.bids.length).toBeGreaterThan(before.game!.bids.length + 1);
    const undone = reducer(after, { type: 'undo', epoch: after.epoch });
    expect(undone.game).toEqual(before.game);
    expect(undone.aiMoves).toBe(before.aiMoves);
    expect(undone.epoch).toBe(after.epoch + 1);
    expect(undone.retry).toMatchObject({ handNumber: 1, attempt: 1, kind: 'undo', kept: before.game!.bids.length, sawResult: false });
    expect(undone.retry!.from.code).toBe(encodeReplay(after.game!));
    expect(undone.practiceHands).toEqual([1]);
  });

  it('steps back through your trump call and plays, one decision per deliberate tap', () => {
    // Every computer seat passes, so you take the contract and call trump.
    let app = untilYou(start('trump-chain'));
    const bid = app;
    app = untilYou(you(app));
    expect(app.game!.phase).toBe('declaring');
    const trump = app;
    app = untilYou(you(app));
    const lead = app;
    app = untilYou(you(app)); // your lead, then the computer replies
    expect(plays(app.game!)).toBeGreaterThan(plays(lead.game!) + 1);
    const checkpoints = [lead, trump, bid];
    for (const expected of checkpoints) {
      const tapped = app.epoch;
      app = reducer(app, { type: 'undo', epoch: tapped });
      expect(app.game).toEqual(expected.game);
      expect(app.aiMoves).toBe(expected.aiMoves);
      expect(app.game!.turn).toBe(HUMAN_SEAT);
      // The same tap delivered twice is ignored instead of taking back another decision.
      expect(reducer(app, { type: 'undo', epoch: tapped })).toBe(app);
    }
    expect(app.retry!.attempt).toBe(3);
    expect(canUndo(app)).toBe(false); // nothing of yours left this hand
    expect(reducer(app, { type: 'undo', epoch: app.epoch })).toBe(app);
    expect(canRestart(app)).toBe(true); // computer bids before yours remain
  });

  it('rolls a finished hand back, removing its marks and result card', () => {
    const begun = start('final-trick');
    const finished = toHandEnd(begun);
    expect(finished.game!.phase).toBe('hand-over');
    expect(canUndo(finished)).toBe(true);
    const undone = reducer(finished, { type: 'undo', epoch: finished.epoch });
    expect(undone.game!.phase).toBe('playing');
    expect(undone.game!.turn).toBe(HUMAN_SEAT);
    expect(undone.game!.handResult).toBeNull();
    expect(undone.game!.marks).toEqual(begun.game!.marks);
    expect(undone.showTrick).toBe(false);
    expect(undone.retry).toMatchObject({ sawResult: true, from: { phase: 'hand-over', handResult: finished.game!.handResult } });
    // Making the same choices again reaches the same result.
    expect(toHandEnd(undone).game).toEqual(finished.game);
    expect(handStartOf(finished.game!)).toEqual(begun.game);
  });

  it('rolls the game-ending hand back from game over', () => {
    let app = start('game-over');
    app = { ...app, game: { ...app.game!, marks: [6, 6] } };
    const over = toHandEnd(app);
    expect(over.game!.phase).toBe('game-over');
    expect(over.game!.winner).not.toBeNull();
    const undone = reducer(over, { type: 'undo', epoch: over.epoch });
    expect(undone.game!.phase).toBe('playing');
    expect(undone.game!.winner).toBeNull();
    expect(undone.game!.marks).toEqual([6, 6]);
    const replayed = reducer(over, { type: 'restart-hand', epoch: over.epoch });
    expect(replayed.game).toEqual(app.game);
  });

  it('cannot reach into an earlier hand once the next is dealt', () => {
    const finished = toHandEnd(start('next-hand'));
    const undone = reducer(finished, { type: 'undo', epoch: finished.epoch });
    const redone = toHandEnd(undone);
    const next = reducer(redone, { type: 'human', action: { type: 'next-hand' } });
    expect(next.retry).toBeNull();
    expect(next.practiceHands).toEqual([1]);
    const fresh = untilYou(next);
    if (fresh.game!.bids.every((b) => b.seat !== HUMAN_SEAT)) {
      expect(canUndo(fresh)).toBe(false);
      expect(reducer(fresh, { type: 'undo', epoch: fresh.epoch }).game).toBe(fresh.game);
    }
    const yoursNow = you(fresh);
    const back = reducer(yoursNow, { type: 'undo', epoch: yoursNow.epoch });
    expect(back.game!.handNumber).toBe(2);
    expect(back.game).toEqual(fresh.game);
  });

  it('ignores the shared-hand view and paused previews', () => {
    const app = untilYou(you(untilYou(start('scenario'))));
    const review = reducer(app, { type: 'view-scenario', game: app.game! });
    expect(canUndo(review)).toBe(false);
    expect(reducer(review, { type: 'undo', epoch: review.epoch })).toBe(review);
    expect(reducer(review, { type: 'restart-hand', epoch: review.epoch })).toBe(review);
  });
});

describe('play this hand again', () => {
  it('replays the exact deal and shaker with the marks it began with, and the same next deal', () => {
    const begun = start('restart');
    const marked = { ...begun, game: { ...begun.game!, marks: [2, 3] as const } };
    const mid = untilYou(you(untilYou(you(untilYou(you(untilYou(marked)))))));
    const replayed = reducer(mid, { type: 'restart-hand', epoch: mid.epoch });
    expect(replayed.game).toEqual(marked.game);
    expect(replayed.aiMoves).toBe(0);
    expect(replayed.auctionSurveys).toEqual({});
    expect(replayed.retry).toMatchObject({ kind: 'restart', kept: 0, attempt: 1 });
    // Same tap twice: one replay.
    expect(reducer(replayed, { type: 'restart-hand', epoch: mid.epoch })).toBe(replayed);
    // The deal after it is the one the original would have reached (not re-dealt from the catalogue).
    const original = toHandEnd(mid);
    const retried = toHandEnd(replayed);
    const nextOriginal = reducer(original, { type: 'human', action: { type: 'next-hand' } }).game!;
    const nextRetried = reducer(retried, { type: 'human', action: { type: 'next-hand' } }).game!;
    expect(nextRetried.dealt).toEqual(nextOriginal.dealt);
    expect(nextRetried.shaker).toBe(nextOriginal.shaker);
    expect(nextRetried.rngState).toBe(nextOriginal.rngState);
  });

  it('replays a thrown-in hand and keeps every setting', () => {
    let app = reducer(initialApp(null), { type: 'set-difficulty', difficulty: 'easy' });
    app = reducer(app, { type: 'set-show-hints', enabled: false });
    app = reducer(app, { type: 'set-think-deeper', enabled: true });
    app = reducer(app, { type: 'new-game', seed: 'thrown', sessionId: 'undo-thrown' });
    const dealt = app;
    const pass = (s: AppState): AppState => reducer(s, { type: 'human', action: { type: 'bid', bid: { kind: 'pass' } } });
    let thrown = untilYou(pass(untilYou(app)));
    expect(thrown.game!.thrownIn).toBe(true);
    const settings = thrown.settings;
    const replayed = reducer(thrown, { type: 'restart-hand', epoch: thrown.epoch });
    expect(replayed.game).toEqual(dealt.game);
    expect(replayed.settings).toBe(settings);
    const undone = reducer(thrown, { type: 'undo', epoch: thrown.epoch });
    expect(undone.game!.phase).toBe('bidding');
    expect(undone.game!.turn).toBe(HUMAN_SEAT);
    // Throwing it in again leads to the same reshake as the original.
    thrown = untilYou(pass(untilYou(replayed)));
    expect(reducer(thrown, { type: 'human', action: { type: 'next-hand' } }).game!.dealt)
      .toEqual(reducer(untilYou(pass(untilYou(app))), { type: 'human', action: { type: 'next-hand' } }).game!.dealt);
    expect(DEFAULT_SETTINGS).toEqual({ difficulty: 'native-partner', preset: 'tournament', thinkDeeper: false, nelloPreview: false, showHints: true });
  });

  it('confirms before replaying; Cancel does nothing', () => {
    const onConfirm = vi.fn(), onCancel = vi.fn();
    const card = (RestartConfirm({ onConfirm, onCancel }) as VNode<{ children: VNode }>).props.children;
    const buttons = (card.props as { children: unknown[] }).children.filter((c): c is VNode => !!c && (c as VNode).type === 'button');
    expect(buttons.map((b) => (b.props as { children: string }).children)).toEqual(['Play this hand again', 'Cancel']);
    (buttons[1]!.props as unknown as { onClick: () => void }).onClick();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('offers undo and replay on the end cards, but not for a shared hand', () => {
    const g = toHandEnd(start('cards')).game!;
    const texts = (v: unknown): string[] => JSON.stringify(v, (k, x) => (k === '__o' || k === '_owner' ? undefined : x)).match(/Undo my last move|Play this hand again/g) ?? [];
    const flatten = (v: unknown): unknown => {
      if (!v || typeof v !== 'object') return v;
      const node = v as VNode;
      if (typeof node.type === 'function') return flatten((node.type as (p: unknown) => unknown)(node.props));
      const kids = (node.props as { children?: unknown } | undefined)?.children;
      return { type: node.type, props: { ...(node.props as object), children: Array.isArray(kids) ? kids.map(flatten) : flatten(kids) } };
    };
    const dispatch = () => {};
    expect(texts(flatten(HandOverSheet({ g, dispatch, onUndo: () => {}, onRestart: () => {} })))).toEqual(['Undo my last move', 'Play this hand again']);
    expect(texts(flatten(HandOverSheet({ g, dispatch, scenario: true, onUndo: () => {}, onRestart: () => {} })))).toEqual([]);
    expect(texts(flatten(GameOverSheet({ g, dispatch, onRestart: () => {} })))).toEqual(['Play this hand again']);
  });
});

describe('late responses after undo or replay', () => {
  it('drops a quick tap that arrives on a computer turn', () => {
    const app = you(untilYou(start('tap')));
    if (pendingAiSeat(app) === null) return;
    const g = app.game!;
    for (const action of legalActions(g)) expect(reducer(app, { type: 'human', action })).toBe(app);
  });

  it('rejects an auction decision from before the undo even when the position is identical', () => {
    const before = untilYou(dealWhereOthersBidAfterYou());
    const asked = you(before);
    expect(pendingAiSeat(asked)).not.toBeNull();
    const decision = { key: auctionKey(asked.game!, asked.sessionId), action: legalActions(asked.game!)[0]!, survey: null };
    const undone = reducer(asked, { type: 'undo', epoch: asked.epoch });
    const again = you(undone); // the very same bid: same position, same request key
    expect(auctionKey(again.game!, again.sessionId)).toBe(decision.key);
    expect(reducer(again, { type: 'auction-ai', decision, epoch: asked.epoch })).toBe(again);
    expect(reducer(again, { type: 'auction-ai', decision, epoch: again.epoch }).game!.bids.length).toBe(again.game!.bids.length + 1);
  });

  it('rejects a Walt receipt and a heuristic step started before the undo', () => {
    let app = untilYou(start('native'));
    while (app.game!.phase !== 'playing' || app.game!.turn !== HUMAN_SEAT) app = untilYou(you(app));
    const asked = you(app);
    const seat = pendingAiSeat(asked);
    expect(seat).not.toBeNull();
    const g = asked.game!, request = requestOf(g, seat!, asked.sessionId);
    const receipt: NativeReceipt = { schema: 'plunge-decision-v1', id: 'b'.repeat(64), created: '2026-10-05T00:00:00Z',
      identity: { request, player: { name: 'l1-partner-rollout' }, implementation: { test: true }, game_id: asked.sessionId, hand_number: g.handNumber },
      response: { choice: tileOfId(legalDominoes(g)[0]!), legal: legalDominoes(g).map(tileOfId), route: 'test', leader: g.leader!, points: [...g.points], elapsed_us: 1 } };
    const undone = reducer(asked, { type: 'undo', epoch: asked.epoch });
    const again = you(undone);
    expect(again.game).toEqual(asked.game);
    expect(reducer(again, { type: 'native-ai', receipt, epoch: asked.epoch })).toBe(again);
    expect(reducer(again, { type: 'ai', choose: cheap, epoch: asked.epoch })).toBe(again);
    const accepted = reducer(again, { type: 'native-ai', receipt, epoch: again.epoch });
    expect(accepted.nativeReceipts[`1:${plays(g)}`]).toBe(receipt.id);
    // Undoing that move takes its receipt link off the table; the earlier snapshot keeps it.
    const later = untilYou(accepted);
    const back = reducer(you(later), { type: 'undo', epoch: later.epoch });
    expect(back.nativeReceipts).toEqual(accepted.nativeReceipts);
    const before = reducer(back, { type: 'undo', epoch: back.epoch });
    expect(before.nativeReceipts[`1:${plays(g)}`]).toBeUndefined();
    expect(snapshotOf(accepted)!.receipts[`1:${plays(g)}`]).toBe(receipt.id);
  });

  it('keeps a completed trick on display when an old pause timer fires', () => {
    // Find a trick that you complete, so the pause starts with your own play.
    let app: AppState | null = null;
    for (let i = 0; i < 30 && !app; i++) {
      let at = untilYou(start(`pause-${i}`));
      while (['bidding', 'declaring', 'playing'].includes(at.game!.phase)) {
        const g = at.game!;
        if (g.phase === 'playing' && g.currentTrick.length === 3) { app = at; break; }
        at = untilYou(you(at));
      }
    }
    if (!app) throw new Error('no trick to finish');
    const shown = you(app);
    expect(shown.showTrick).toBe(true);
    const oldTimer = shown.epoch;
    const undone = reducer(shown, { type: 'undo', epoch: shown.epoch });
    expect(undone.showTrick).toBe(false);
    const again = you(undone);
    expect(again.showTrick).toBe(true);
    expect(reducer(again, { type: 'trick-shown', epoch: oldTimer })).toBe(again);
    expect(reducer(again, { type: 'trick-shown', epoch: again.epoch }).showTrick).toBe(false);
  });
});

describe('saves', () => {
  const memory = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
  };
  it('keeps retry provenance and checkpoints through a reload', () => {
    const app = untilYou(you(untilYou(you(untilYou(start('reload'))))));
    const undone = reducer(app, { type: 'undo', epoch: app.epoch });
    const storage = memory();
    saveApp(storage, undone);
    const loaded = initialApp(loadApp(storage));
    expect(loaded.retry).toEqual(undone.retry);
    expect(loaded.epoch).toBe(undone.epoch);
    expect(loaded.practiceHands).toEqual([1]);
    expect(questionGameId(loaded)).toBe('undo-reload-r1');
    const resumed = reducer(loaded, { type: 'resume' });
    expect(canUndo(resumed)).toBe(true);
    expect(reducer(resumed, { type: 'undo', epoch: resumed.epoch }).retry!.attempt).toBe(2);
  });

  it('loads saves from before undo, with checkpoints derived from the hand itself', () => {
    const app = untilYou(you(untilYou(start('old-save'))));
    const { epoch: _e, retry: _r, practiceHands: _p, ...old } = toSaved(app);
    const storage = memory();
    storage.setItem('plunge:save:v1', JSON.stringify(old));
    const loaded = reducer(initialApp(loadApp(storage)), { type: 'resume' });
    expect(loaded.epoch).toBe(0);
    expect(loaded.retry).toBeNull();
    expect(loaded.practiceHands).toEqual([]);
    expect(canUndo(loaded)).toBe(true);
    expect(reducer(loaded, { type: 'undo', epoch: 0 }).game!.bids.length).toBeLessThan(app.game!.bids.length);
  });

  it('rejects malformed retry fields and drops provenance from another hand', () => {
    const app = start('bad-save');
    const storage = memory();
    const save = (extra: Partial<Record<keyof SavedState, unknown>>) => storage.setItem('plunge:save:v1', JSON.stringify({ ...toSaved(app), ...extra }));
    save({ epoch: -1 }); expect(loadApp(storage)).toBeNull();
    save({ retry: { handNumber: 1, attempt: 0 } }); expect(loadApp(storage)).toBeNull();
    save({ practiceHands: ['1'] }); expect(loadApp(storage)).toBeNull();
    const other = { handNumber: 9, attempt: 1, kind: 'undo', kept: 0, sawResult: false, from: { code: null, phase: 'playing', marks: [0, 0], handResult: null, winner: null, thrownIn: false } };
    save({ retry: other });
    expect(initialApp(loadApp(storage)).retry).toBeNull();
  });
});

describe('append-only history', () => {
  it('keeps the original finished hand as written and records the retry as practice', async () => {
    const finished = toHandEnd(start('history-a', 'undo-history-a'));
    await recordHistory(finished);
    const original = (await listHands()).filter((h) => h.gameId === 'undo-history-a');
    expect(original).toHaveLength(1);
    expect(original[0]!.code).toBe(encodeReplay(finished.game!));

    const undone = reducer(finished, { type: 'undo', epoch: finished.epoch });
    await recordHistory(finished); // App records the branch being left; content ids make this idempotent
    await recordHistory(undone);
    const retried = toHandEnd(undone, 6); // a different last domino where there is a choice
    await recordHistory(retried);

    const hands = (await listHands()).filter((h) => h.gameId === 'undo-history-a');
    expect(hands).toEqual(original); // no overwrite; the retry has its own branch record
    const branchHands = (await listHands()).filter((h) => h.gameId === 'undo-history-a-r1');
    expect(branchHands.map((h) => [h.code, h.practiceHands])).toEqual([[encodeReplay(retried.game!), [1]]]);
    const events = (await listHistory()) as Array<ReturnType<typeof snapshotOf> & { retry?: Record<string, unknown> }>;
    const mine = events.filter((e) => e!.gameId === 'undo-history-a');
    expect(mine.some((e) => !e!.retry && e!.code === encodeReplay(finished.game!) && e!.phase === 'hand-over')).toBe(true);
    const branch = mine.filter((e) => e!.retry);
    expect(branch.length).toBeGreaterThanOrEqual(2);
    for (const e of branch) {
      expect(e!.retry).toMatchObject({ practice: true, root: { gameId: 'undo-history-a', handNumber: 1 }, branch: 'undo-history-a-r1', attempt: 1, kind: 'undo' });
      expect((e!.retry!.from as { code: string }).code).toBe(encodeReplay(finished.game!));
    }
    expect(branch.some((e) => e!.code === encodeReplay(retried.game!) && e!.phase === 'hand-over')).toBe(true);
    const exported = JSON.parse(await exportHistory()) as { events: Array<{ gameId: string; retry?: unknown }> };
    expect(exported.events.filter((e) => e.gameId === 'undo-history-a' && e.retry).length).toBe(branch.length);
  });

  it('keeps the branch left by a mid-hand takeback, the retry under its own id, and marks later hands of that game', async () => {
    const mid = untilYou(you(untilYou(you(untilYou(start('history-b', 'undo-history-b'))))));
    await recordHistory(mid);
    expect((await listHands()).filter((h) => h.gameId === 'undo-history-b')).toEqual([]); // still in play: nothing to log yet
    const undone = reducer(mid, { type: 'undo', epoch: mid.epoch });
    await recordHistory(mid, true); // App logs the branch being left, undone moves and all
    const retried = toHandEnd(undone);
    await recordHistory(retried);
    expect((await listHands()).filter((h) => h.gameId === 'undo-history-b').map((h) => h.code)).toEqual([encodeReplay(mid.game!)]);
    expect((await listHands()).filter((h) => h.gameId === 'undo-history-b-r1').map((h) => h.code)).toEqual([encodeReplay(retried.game!)]);
    const second = toHandEnd(reducer(retried, { type: 'human', action: { type: 'next-hand' } }));
    expect(snapshotOf(second)!.practiceHands).toEqual([1]);
    expect('retry' in snapshotOf(second)!).toBe(false);
    await recordHistory(second);
    const hands = (await listHands()).filter((h) => h.gameId === 'undo-history-b' && h.handNumber === 2);
    expect(hands.map((h) => [h.handNumber, h.practiceHands])).toEqual([[2, [1]]]);
  });

  it('leaves ordinary snapshots and finished records exactly as before', async () => {
    const plain = toHandEnd(start('history-c', 'undo-history-c'));
    const snapshot = snapshotOf(plain)!;
    expect('retry' in snapshot || 'practiceHands' in snapshot).toBe(false);
    await recordHistory(plain);
    const [hand] = (await listHands()).filter((h) => h.gameId === 'undo-history-c');
    expect(hand && 'practiceHands' in hand).toBe(false);
    // The exact Walt at the table travels with the record, so a later job can compare the human's play with it.
    expect(hand!.walt).toEqual({ player: 'walt-table-v2', source_commit: expect.stringMatching(/^[a-f0-9]{40}$/), wasm_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(hand!.build).toMatch(/^(dev|[a-f0-9]{40})$/); // 'dev' locally, the commit SHA in CI builds
  });
});

describe('questions on a retried hand', () => {
  it('get their own branch and never receive another branch’s finished hand', async () => {
    let app = untilYou(start('questions', 'undo-questions'));
    while (!(app.game!.phase === 'playing' && plays(app.game!) > 0 && app.game!.turn === HUMAN_SEAT)) app = untilYou(you(app));
    const asked = await saveQuestion(app.game!, 0, app.sessionId, null, undefined, null, null, undefined, questionGameId(app));
    expect(asked.question.game_id).toBe('undo-questions');
    const undone = untilYou(you(reducer(app, { type: 'undo', epoch: app.epoch }), 1));
    const branch = questionGameId(undone);
    expect(branch).toBe('undo-questions-r1');
    const retry = await saveQuestion(undone.game!, 0, undone.sessionId, null, undefined, null, null, undefined, branch);
    expect(retry.question.id).not.toBe(asked.question.id); // not merged into the original bookmark
    expect(retry.question.seed).toBe(asked.question.seed); // seeds still follow the session
    const finished = toHandEnd(undone);
    await attachGame(finished.game!, questionGameId(finished));
    const saved = await listQuestions();
    expect(saved.find((q) => q.question.id === asked.question.id)!.question.replay).toBe(asked.question.replay);
    expect(saved.find((q) => q.question.id === retry.question.id)!.question.replay).toBe(encodeReplay(finished.game!));
  });
});


/** Render function components down to host vnodes (no hooks involved). */
function flatten(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(flatten);
  const node = v as VNode;
  if (typeof node.type === 'function') return flatten((node.type as (p: unknown) => unknown)(node.props));
  const kids = (node.props as { children?: unknown } | undefined)?.children;
  return { type: node.type, props: { ...(node.props as object), children: flatten(kids) } };
}
function buttons(v: unknown, out: Array<{ text: string; onClick: () => void }> = []) {
  if (Array.isArray(v)) { for (const x of v) buttons(x, out); return out; }
  if (!v || typeof v !== 'object') return out;
  const node = v as { type: unknown; props: { children?: unknown; onClick?: () => void } };
  if (node.type === 'button' && node.props.onClick) out.push({ text: text(node.props.children), onClick: node.props.onClick });
  buttons(node.props?.children, out);
  return out;
}
function text(v: unknown): string {
  if (v === null || v === undefined || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(text).join('');
  return text((v as { props?: { children?: unknown } }).props?.children);
}
const undo = (app: AppState) => reducer(app, { type: 'undo', epoch: app.epoch });

describe('a tap rendered before an undo or replay', () => {
  /** The tap as the live table would send it, stamped with the generation it was rendered in. */
  const tap = (app: AppState, action: Action) => ({ type: 'human' as const, action, epoch: app.epoch });

  it('is dropped at the identical bid position after undo, and after replay', () => {
    const before = untilYou(dealWhereOthersBidAfterYou());
    const stale = tap(before, yours(before.game!));
    const after = reducer(before, stale);
    const undone = undo(untilYou(after));
    expect(undone.game).toEqual(before.game);
    expect(reducer(undone, stale)).toBe(undone);
    expect(reducer(undone, { ...stale, epoch: undone.epoch }).game).toEqual(after.game);
    const replayed = untilYou(reducer(untilYou(after), { type: 'restart-hand', epoch: after.epoch }));
    expect(replayed.game).toEqual(before.game);
    expect(reducer(replayed, stale)).toBe(replayed);
  });

  it('is dropped at the identical trump call and play', () => {
    let app = untilYou(you(untilYou(start('stale-trump'))));
    expect(app.game!.phase).toBe('declaring');
    const trump = tap(app, yours(app.game!));
    let undone = undo(untilYou(reducer(app, trump)));
    expect(undone.game).toEqual(app.game);
    expect(reducer(undone, trump)).toBe(undone);
    app = untilYou(reducer(undone, { ...trump, epoch: undone.epoch }));
    expect(app.game!.phase).toBe('playing');
    const play = tap(app, yours(app.game!));
    undone = undo(untilYou(reducer(app, play)));
    expect(undone.game).toEqual(app.game);
    expect(reducer(undone, play)).toBe(undone);
    expect(reducer(undone, { ...play, epoch: undone.epoch }).game).not.toBe(undone.game);
  });

  it('is dropped when the same finished hand is reached again', () => {
    const finished = toHandEnd(start('stale-next'));
    const next = tap(finished, { type: 'next-hand' });
    const again = toHandEnd(undo(finished));
    expect(again.game).toEqual(finished.game);
    expect(reducer(again, next)).toBe(again);
    expect(reducer(again, { ...next, epoch: again.epoch }).game!.handNumber).toBe(2);
  });

  it('is what the live table sends: liveDispatch stamps human decisions only', () => {
    const sent: AppEvent[] = [];
    const live = liveDispatch((e) => sent.push(e), 7);
    live({ type: 'human', action: { type: 'next-hand' } });
    live({ type: 'go', screen: 'home' });
    expect(sent).toEqual([{ type: 'human', action: { type: 'next-hand' }, epoch: 7 }, { type: 'go', screen: 'home' }]);
    // Through the real sheets: the end card's next-hand and the trump buttons.
    const finished = toHandEnd(start('live-sheets'));
    buttons(flatten(HandOverSheet({ g: finished.game!, dispatch: live }))).find((b) => b.text === 'Shake the next hand')!.onClick();
    const declaring = untilYou(you(untilYou(start('stale-trump'))));
    buttons(flatten(DeclareSheet({ g: declaring.game!, dispatch: live, showHints: false, sessionId: 's', onQuestion: () => {} })))[0]!.onClick();
    expect(sent.slice(2).map((e) => e.type === 'human' && e.epoch)).toEqual([7, 7]);
  });
});

describe('settings changed mid-hand', () => {
  it('Walt version and Nel-O preview toggles during the auction keep Undo exact', () => {
    const before = untilYou(dealWhereOthersBidAfterYou());
    let after = you(before); // computer bids still to come
    expect(after.game!.phase).toBe('bidding');
    expect(pendingAiSeat(after)).not.toBeNull();
    after = reducer(after, { type: 'set-nello-preview', enabled: true });
    after = reducer(after, { type: 'set-difficulty', difficulty: 'native-l1' });
    expect(after.game!.config).toEqual(PLUNGE_CONFIG);
    expect(canUndo(after)).toBe(true);
    const undone = undo(after);
    expect(undone.game).toEqual({ ...before.game, config: PLUNGE_CONFIG });
    expect(undone.settings).toBe(after.settings);
    const replayed = reducer(after, { type: 'restart-hand', epoch: after.epoch });
    expect(replayed.settings).toBe(after.settings);
    expect(replayed.game!.config).toEqual(PLUNGE_CONFIG);
  });

  it('toggles while you call trump, and back off in play', () => {
    let app = untilYou(you(untilYou(start('toggle-trump'))));
    expect(app.game!.phase).toBe('declaring');
    for (const enabled of [true, false, true]) {
      app = reducer(app, { type: 'set-nello-preview', enabled });
      expect(canUndo(app)).toBe(true);
      const undone = undo(app);
      expect(undone.game!.phase).toBe('bidding');
      expect(undone.game!.turn).toBe(HUMAN_SEAT);
      expect(undone.game!.config).toEqual(enabled ? PLUNGE_CONFIG : LEGACY_PLUNGE_CONFIG);
      expect(undone.settings).toBe(app.settings);
    }
    app = untilYou(you(app)); // trump called with the preview on: the contract keeps PLUNGE rules
    app = untilYou(you(app));
    app = reducer(app, { type: 'set-nello-preview', enabled: false });
    expect(app.game!.config).toEqual(PLUNGE_CONFIG);
    expect(canUndo(app)).toBe(true);
    expect(undo(app).game!.config).toEqual(PLUNGE_CONFIG); // still in play: rules unchanged
    const toTrump = undo(undo(app));
    expect(toTrump.game!.phase).toBe('declaring');
    expect(toTrump.game!.config).toEqual(LEGACY_PLUNGE_CONFIG); // auction again: current availability
  });

  it('a legacy rules switch that would reinterpret a forced bid offers only a replay', () => {
    let app: AppState | null = null;
    for (let i = 0; i < 40 && !app; i++) { const a = start(`forced-${i}`); if (a.game!.shaker === HUMAN_SEAT) app = a; }
    app = untilYou(app!); // three passes: you are forced to bid
    expect(app.game!.bids.every((b) => b.bid.kind === 'pass')).toBe(true);
    app = untilYou(you(app));
    expect(app.game!.phase).toBe('declaring');
    expect(app.game!.forcedBid).toBe(true);
    expect(canUndo(app)).toBe(true);
    const legacy = reducer(app, { type: 'set-difficulty', difficulty: 'easy' });
    expect(legacy.game!.config).toEqual(TOURNAMENT_CONFIG); // reshake: three passes would no longer force you
    expect(canUndo(legacy)).toBe(false); // not offered…
    expect(reducer(legacy, { type: 'undo', epoch: legacy.epoch })).toBe(legacy); // …and never a hidden no-op
    expect(canRestart(legacy)).toBe(true);
    const replayed = reducer(legacy, { type: 'restart-hand', epoch: legacy.epoch });
    expect(replayed.game).toEqual({ ...handStartOf(app.game!), config: TOURNAMENT_CONFIG });
    expect(replayed.settings).toBe(legacy.settings);
  });
});

describe('practice is visible', () => {
  it('labels the end cards of an undone or replayed hand', () => {
    const g = toHandEnd(start('practice-cards')).game!;
    const eyebrow = (v: unknown) => text(flatten(v)).includes('Practice');
    expect(eyebrow(HandOverSheet({ g, dispatch: () => {}, practice: true }))).toBe(true);
    expect(eyebrow(HandOverSheet({ g, dispatch: () => {} }))).toBe(false);
    expect(eyebrow(GameOverSheet({ g, dispatch: () => {}, practice: true }))).toBe(true);
  });
});


describe('a finished game after reload', () => {
  const reload = (app: AppState): AppState => {
    const map = new Map<string, string>();
    saveApp({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }, app);
    return initialApp(loadApp({ getItem: (k) => map.get(k) ?? null, setItem: () => {}, removeItem: () => {} }));
  };
  /** Home's buttons, with the events they send. */
  const home = (app: AppState) => {
    const sent: AppEvent[] = [];
    return { sent, buttons: buttons(flatten(Home({ app, dispatch: (e) => sent.push(e) }))) };
  };
  const resume = (app: AppState): AppState => {
    const h = home(app);
    expect(h.buttons.map((b) => b.text).slice(0, 2)).toEqual(['Resume your game', 'Deal me in']);
    h.buttons[0]!.onClick();
    expect(h.sent).toEqual([{ type: 'resume' }]);
    return reducer(app, h.sent[0]!);
  };

  it('can be resumed to its result card, and stays reachable after Undo or a replay', () => {
    const begun = start('reload-over');
    const over = toHandEnd({ ...begun, game: { ...begun.game!, marks: [6, 6] } });
    expect(over.game!.phase).toBe('game-over');
    expect(over.showTrick).toBe(false);

    const loaded = reload(over);
    expect(loaded.screen).toBe('home');
    const resumed = resume(loaded);
    // The table shows the game-over card (phase game-over, no trick on display), with both choices.
    expect(resumed.screen).toBe('table');
    expect(resumed.game).toEqual(over.game);
    expect(resumed.showTrick).toBe(false);
    const card = buttons(flatten(GameOverSheet({ g: resumed.game!, dispatch: () => {},
      onUndo: canUndo(resumed) ? () => {} : undefined, onRestart: canRestart(resumed) ? () => {} : undefined }))).map((b) => b.text);
    expect(card).toEqual(expect.arrayContaining(['Play again', 'Undo my last move', 'Play this hand again']));
    // "Deal me in" still starts a fresh game from Home.
    const fresh = home(loaded);
    fresh.buttons[1]!.onClick();
    expect(fresh.sent[0]).toMatchObject({ type: 'new-game' });

    const undone = resume(reload(undo(resumed)));
    expect(undone.game!.phase).toBe('playing');
    expect(undone.game!.marks).toEqual([6, 6]);
    expect(undone.retry).toMatchObject({ kind: 'undo', sawResult: true });

    const replayed = resume(reload(reducer(resumed, { type: 'restart-hand', epoch: resumed.epoch })));
    expect(replayed.game!.phase).toBe('bidding');
    expect(replayed.game!.marks).toEqual([6, 6]);
    expect(replayed.retry).toMatchObject({ kind: 'restart' });

    // Finishing the replayed hand again is still reachable after another reload.
    const overAgain = toHandEnd(replayed);
    expect(overAgain.game!.phase).toBe('game-over');
    expect(resume(reload(overAgain)).game).toEqual(overAgain.game);
  });
});
