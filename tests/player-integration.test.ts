import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync, play, version, netId, type Forecast } from '@jasonyandell/zeb';
import { applyAction, legalActions, newGame, PLUNGE_CONFIG, type GameState, type Seat } from '../src/engine';
import { initialApp, reducer, toSaved, loadApp } from '../src/ui/store';
import { playerIdentity, playerKey, playerEvent, effectivePlayer, handPlayers, PLAYERS } from '../src/ai/players';
import { auctionKey } from '../src/ai/auction';
import { zebPosition, zebAuctionMove } from '../src/ai/zeb';
import { nativeMove, requestOf, checkedAction } from '../src/ai/native';
import { getHint, hintExplanation } from '../src/ai/hint';
import { createRoom, commandRoom, joinRoom, settleRoom, roomSnapshot, GRACE, roomHandEntry } from '../worker/rooms';
import { upgradeRoom } from '../worker/room-undo';
import { rotateGame, roomHistory } from '../src/room/view';
import { receiptForViewer, keepRoomReceipts } from '../src/room/receipts';
import { getReceipt } from '../src/ai/phone/records';
import { saveHintQuestion, saveQuestion } from '../src/questions/client';
import { validQuestion } from '../src/questions/model';
import { validHandRecord } from '../src/history/hand-record';
import { recordHistory } from '../src/history/recorder';
import { listHands } from '../src/history/legacy';
import { encodeReplay } from '../src/engine/replay-code';
vi.mock('../src/ai/zeb/client', () => ({ runZeb: vi.fn() }));
import { runZeb } from '../src/ai/zeb/client';

beforeAll(() => {
  initSync({ module: readFileSync(createRequire(import.meta.url).resolve('@jasonyandell/zeb/zeb_bg.wasm')) });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
});
const declared = (seed = 'model-test'): GameState => {
  let g = newGame(PLUNGE_CONFIG, seed);
  g = applyAction(g, { type: 'bid', bid: { kind: 'points', value: 30 } });
  for (let i = 0; i < 3; i++) g = applyAction(g, { type: 'bid', bid: { kind: 'pass' } });
  return applyAction(g, { type: 'declare', decl: { type: 'pip', pip: 6 } });
};
const mockPlay = () => vi.mocked(runZeb).mockImplementation(async call => {
  if (call.kind !== 'play') throw new Error('Expected play');
  return { value: play({ ...call.request, worlds: 4 }), version: version(), net: netId(), elapsed_us: 1 };
});
const forecasts = (): Forecast[] => [0,1,2,3,4,5,6,7,9].map(decl => ({ decl, mean: 30, pmake: Array(13).fill(decl === 6 ? 0.9 : 0.1) }));

describe('versioned computer players', () => {
  it('pins package identity and records mixed-model actions, takebacks, saves and logs without a false Walt manifest', async () => {
    expect(PLAYERS.zeb.version).toBe(version());
    const a = reducer(initialApp(), { type: 'new-game', seed: 'identity', sessionId: 'model-log' });
    const first = reducer(a, { type: 'auction-ai', decision: { key: auctionKey(a.game!, a.sessionId), action: legalActions(a.game!)[0]!, survey: null } });
    // Historical mixed-model logs remain readable; new switches now end the game.
    const switched = { ...first, settings: { ...first.settings, difficulty: 'zeb' as const }, epoch: first.epoch + 1 };
    const next = reducer(switched, { type: 'auction-ai', epoch: switched.epoch, decision: { key: auctionKey(switched.game!, switched.sessionId), action: legalActions(switched.game!)[0]!, survey: null } });
    expect(handPlayers(next.playerEvents, 1).map(m => m.id)).toEqual(['native-partner', 'zeb']);
    const storage = { getItem: () => JSON.stringify(toSaved(next)) };
    expect(initialApp(loadApp(storage as never)).playerEvents).toEqual(next.playerEvents);
    await recordHistory(next, true);
    const record = (await listHands()).find(h => h.gameId === 'model-log')!;
    expect(record.walt).toBeUndefined();
    expect(record.models?.map(m => m.id)).toEqual(['native-partner', 'zeb']);
    expect(validHandRecord(record).record.playerEvents).toEqual(next.playerEvents);
    const undone = reducer(next, { type: 'restart-hand', epoch: next.epoch });
    expect(undone.playerEvents).toEqual([]);
    expect((await listHands()).find(h => h.gameId === 'model-log')!.models).toEqual(record.models);
    expect(effectivePlayer('zeb', { contract: { kind: 'nello', value: 1 } })).toBe('native-partner');
  });

  it('makes the room selection authoritative, voted, stale-safe and version checked, including takeover', () => {
    const room = createRoom('a'.repeat(32), 'Host', 'h'.repeat(64), 1000);
    joinRoom(room, 'Partner', 'p'.repeat(64), 1000);
    const both = new Set<Seat>([0,2]);
    commandRoom(room, 0, { type: 'propose', id: 'zeb', revision: room.state.revision, kind: 'player', player: 'zeb' }, both, 1000);
    expect(room.state.player).toBe('native-partner');
    commandRoom(room, 2, { type: 'vote', id: 'yes', proposal: 'zeb', vote: 'yes' }, both, 1001);
    expect(room.state.player).toBe('zeb');
    commandRoom(room, 0, { type: 'propose', id: 'start', revision: room.state.revision, kind: 'start' }, both, 1002);
    settleRoom(room, both, 7003);
    expect(room.state.game!.hands).toEqual(newGame(PLUNGE_CONFIG, room.state.seed).hands);
    while (room.state.game!.turn === 0 || room.state.game!.turn === 2) {
      const at = room.state.game!; commandRoom(room, at.turn!, { type: 'action', id: `human-${room.state.revision}`, revision: room.state.revision, action: legalActions(at)[0]! }, both, 8000);
    }
    const g = room.state.game!, command = { type: 'action' as const, id: 'ai', revision: room.state.revision, action: legalActions(g)[0]! };
    expect([1,3]).toContain(g.turn);
    expect(() => commandRoom(room, 0, command, both, 8000)).toThrow(/version/);
    expect(() => commandRoom(room, 0, { ...command, modelKey: playerKey('native-partner') }, both, 8000)).toThrow(/version/);
    commandRoom(room, 0, { ...command, modelKey: playerKey('zeb') }, both, 8000);
    expect(room.state.playerEvents?.[0]?.model).toEqual(playerIdentity('zeb'));
    const view = reducer(initialApp(), { type: 'room-snapshot', state: roomSnapshot(room, both, 8000), localSeat: 2 });
    expect(view.settings.difficulty).toBe('zeb');
    expect(roomHistory(room.state, 2).settings.difficulty).toBe('zeb');
    expect(roomSnapshot(room, new Set<Seat>([2]), 8000 + GRACE).runner).toBe(2);
    expect(roomSnapshot(room, new Set<Seat>([2]), 8000 + GRACE).player).toBe('zeb');
    const stale = { ...command, id: 'late', modelKey: playerKey('zeb') };
    expect(() => commandRoom(room, 0, stale, both, 9000)).toThrow(/table changed/);
    const entry = roomHandEntry(room)!;
    expect(entry.record.models).toEqual([playerIdentity('zeb')]);
  });

  it('persists a package upgrade and rejects already-running decisions from the old package', () => {
    const room = createRoom('c'.repeat(32), 'Host');
    room.state = { ...room.state, player: 'zeb', modelKey: 'zeb@old', thinkingSeat: 1 };
    const revision = room.state.revision;
    expect(upgradeRoom(room)).toBe(true);
    expect(room.state).toMatchObject({ modelKey: playerKey('zeb'), revision: revision + 1, thinkingSeat: null });
    expect(upgradeRoom(room)).toBe(false);
  });

  it('keeps Zeb play receipts for every room viewer, projects seats with a new id, and accepts them in questions', async () => {
    mockPlay();
    const room = createRoom('b'.repeat(32), 'Host');
    const g = declared();
    room.state = { ...room.state, player: 'zeb', modelKey: playerKey('zeb'), sessionId: 'receipt-room', game: g };
    const r = await nativeMove(g, g.turn!, 'zeb', room.state.sessionId);
    const action = checkedAction(g, requestOf(g, g.turn!, room.state.sessionId), r);
    expect(action).toBeDefined();
    const command = { type: 'action' as const, id: 'play', revision: room.state.revision, action, modelKey: playerKey('zeb'), receiptId: r.id, receipt: r };
    expect(() => commandRoom(room, 0, { ...command, receipt: { ...r, identity: { ...r.identity, player: { name: 'l1-default' } } } }, new Set<Seat>([0]))).toThrow(/scores/);
    commandRoom(room, 0, command, new Set<Seat>([0]));
    expect(room.state.decisionReceipts?.['1:0']).toEqual(r);
    for (const viewer of [0,1,2,3] as const) {
      const ids = await keepRoomReceipts(room.state, viewer), projected = await getReceipt(ids['1:0']!);
      expect(projected).toEqual(await receiptForViewer(r, viewer));
      if (viewer) expect(projected.perspective).toEqual({ sourceId: r.id, viewer });
      const rotated = rotateGame(room.state.game!, viewer);
      const q = await saveQuestion(rotated, 0, `room-view-${viewer}`, projected.id, 'Zeb move', null, projected, r.identity.request.seed);
      expect(validQuestion(q.question).receipt?.identity.player.name).toBe(PLAYERS.zeb.receiptName);
    }
    expect(await getReceipt(r.id)).toEqual(r);
  });

  it('saves actual Zeb move hints, deeper budgets and forecast hints with their model identity', async () => {
    mockPlay();
    const original = declared(), g = rotateGame(original, original.turn!);
    const hint = await getHint(g, 'zeb-hint', 512, undefined, 'zeb');
    expect(hint.estimate?.identity.player.name).toBe(PLAYERS.zeb.receiptName);
    expect(hint.requestedWorlds).toBe(512);
    expect(hintExplanation(hint)).toContain('weighted estimate');
    const question = await saveHintQuestion(g, 'zeb-hint', { kind: 'move', model: playerIdentity('zeb'), requested_worlds: 512,
      choice: hint.choice!, forced: false, estimate: hint.estimate, explanation: hintExplanation(hint), context: 'Choosing the lead.' });
    expect(validQuestion(question.question).hint).toMatchObject({ model: playerIdentity('zeb') });
    const fresh = newGame(PLUNGE_CONFIG, 'forecast'), bidder = rotateGame(fresh, fresh.turn!);
    const d = await zebAuctionMove(bidder, 0, 'forecast', undefined, undefined, async () => ({ value: forecasts(), version: version(), net: netId(), elapsed_us: 2 }));
    const forecast = await saveHintQuestion(bidder, 'forecast', { kind: 'bid', source: 'zeb', model: playerIdentity('zeb'),
      survey: d.survey?.schema === 'zeb-auction-v1' ? d.survey : null, action: d.action, heading: 'Zeb suggests a bid', explanation: 'Sampled forecast.' });
    expect(validQuestion(forecast.question).hint).toMatchObject({ source: 'zeb' });
    expect(encodeReplay(bidder)).toBe(forecast.question.snapshot);
  });
});
