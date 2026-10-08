import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, newGame, newDealtGame, LEGACY_PLUNGE_CONFIG, PLUNGE_CONFIG, type Seat } from '../src/engine';
import { decodeReplay } from '../src/engine/replay-code';
import fixtures from './fixtures/nello.json';
import { idOfTile } from '../src/ai/walt/requests';
import { rotateGame } from '../src/room/view';
import { initialApp } from '../src/ui/store';
import { recordHistory, listHistory, snapshotOf } from '../src/history/recorder';
import { listHands } from '../src/history/legacy';
import { roomCode, roomFromInput, roomFromHash, savedSeat, saveSeat } from '../src/room/client';
import { roomHistory } from '../src/room/view';
import { createRoom, joinRoom, roomSnapshot, commandRoom, settleRoom } from '../worker/rooms';

describe('room presentation and recorder boundaries', () => {
  it('puts every viewer at seat zero with legal actions unchanged through a complete hand', () => {
    let game = newGame(LEGACY_PLUNGE_CONFIG, 'room-view');
    for (let n = 0; n < 35 && !['hand-over','game-over'].includes(game.phase); n++) {
      for (const seat of [0,1,2,3] as Seat[]) {
        const view = rotateGame(game, seat);
        expect(view.hands[0]).toEqual(game.hands[seat]);
        expect(view.hands[2]).toEqual(game.hands[(seat + 2) % 4]);
        expect(view.turn === 0).toBe(game.turn === seat);
        expect(view.marks[0]).toBe(game.marks[seat % 2]);
        expect(view.points[0]).toBe(game.points[seat % 2]);
        expect(legalActions(view)).toEqual(legalActions(game));
      }
      game = applyAction(game, legalActions(game)[0]!);
    }
    expect(game.handResult).not.toBeNull();
  });
  it('keeps shared hand evidence separately from solo finished-hand stats', async () => {
    let game = newGame(LEGACY_PLUNGE_CONFIG, 'record-room');
    while (!['hand-over','game-over'].includes(game.phase)) game = applyAction(game, legalActions(game)[0]!);
    const app = { ...initialApp(), game, sessionId: 'shared-room-test', nativeReceipts: { '1:2': 'a'.repeat(64) },
      room: { mode: 'shared-room' as const, localSeat: 2 as Seat, revision: 30, humans: [{ seat: 0 as Seat, name: 'Host' }, { seat: 2 as Seat, name: 'Guest' }] } };
    await recordHistory(app);
    expect((await listHistory()).some(e => (e as {room?:unknown}).room)).toBe(true);
    expect((await listHands()).some(e => e.gameId === app.sessionId)).toBe(false);
    expect(snapshotOf(app)?.receipts).toEqual({ '1:2': 'a'.repeat(64) });
    expect(snapshotOf(initialApp())?.room).toBeUndefined();
    const solo = { ...initialApp(), game, sessionId: 'solo-record-test' };
    await recordHistory(solo);
    expect((await listHands()).some(e => e.gameId === solo.sessionId)).toBe(true);
  });
  it('rotates Nel-O turns, sitting-out partner and final scoreboard for every viewer', () => {
    for (const fixture of fixtures) {
      const original = decodeReplay(fixture.replay)!;
      let game = newDealtGame(PLUNGE_CONFIG, original.dealt, original.shaker);
      game = applyAction(game, { type: 'bid', bid: { kind: 'marks', value: 1 } });
      for (let n = 0; n < 3; n++) game = applyAction(game, { type: 'bid', bid: { kind: 'pass' } });
      game = applyAction(game, { type: 'declare', decl: { type: 'nello' } });
      for (let ply = 0; ply < fixture.plays.length / 2; ply++) {
        for (const viewer of [0, 1, 2, 3] as Seat[]) {
          const view = rotateGame(game, viewer);
          expect(view.sittingOut).toBe((game.sittingOut! - viewer + 4) % 4);
          expect(view.turn).not.toBe(view.sittingOut);
          expect(view.hands[view.sittingOut!]!.length).toBe(7);
          expect(legalActions(view)).toEqual(legalActions(game));
        }
        game = applyAction(game, { type: 'play', domino: idOfTile(fixture.plays[2 * ply + 1]!) });
      }
      expect(game.handResult).not.toBeNull();
      for (const viewer of [0, 1, 2, 3] as Seat[]) {
        const view = rotateGame(game, viewer);
        expect(view.handResult!.team).toBe((game.handResult!.team + viewer) % 2);
        expect(view.marks[0]).toBe(game.marks[viewer % 2]);
        expect(view.marks[1]).toBe(game.marks[(viewer + 1) % 2]);
      }
    }
  });
  it('retains completed shared attempts and retry lineage without adding solo wins', async () => {
    const room = createRoom('d'.repeat(32), 'Host', 'e'.repeat(64));
    joinRoom(room, 'Guest', 'f'.repeat(64));
    const connected = new Set<Seat>([0, 2]);
    commandRoom(room, 0, { type: 'propose', kind: 'start', id: 'history-start', revision: room.state.revision }, connected, 1000);
    settleRoom(room, connected, 6001);
    room.state.sessionId = 'shared-retry-history';
    let moves = 0;
    const finish = () => {
      while (!['hand-over', 'game-over'].includes(room.state.game!.phase)) {
        const turn = room.state.game!.turn!;
        commandRoom(room, room.players[turn] ? turn : 0, { type: 'action', id: `history-move-${moves++}`, revision: room.state.revision,
          action: legalActions(room.state.game!)[0]! }, connected, Math.max(1001 + moves, room.state.holdUntil));
      }
    };
    finish();
    const original = roomHistory(roomSnapshot(room, connected), 2);
    await recordHistory(original);
    commandRoom(room, 0, { type: 'propose', kind: 'undo', id: 'history-undo', revision: room.state.revision }, connected, room.state.holdUntil);
    settleRoom(room, connected, room.state.holdUntil + 6001);
    const undone = roomHistory(roomSnapshot(room, connected), 2);
    expect(undone.game!.handResult).toBeNull();
    expect(undone.settings.nelloPreview).toBe(true);
    await recordHistory(undone);
    finish();
    const retried = roomHistory(roomSnapshot(room, connected), 2);
    await recordHistory(retried);
    const events = (await listHistory()).filter((event: any) => event.gameId === room.state.sessionId) as any[];
    expect(events.filter(e => e.handResult).length).toBe(2);
    expect(events.find(e => !e.retry)?.handResult).toEqual(original.game!.handResult);
    expect(events.filter(e => e.retry).every(e => e.retry.practice && e.retry.root.gameId === room.state.sessionId
      && e.retry.from.handResult && e.retry.sawResult && e.practiceHands.includes(1))).toBe(true);
    expect((await listHands()).some(e => e.gameId === room.state.sessionId)).toBe(false);
  });
  it('restores only a valid room seat and accepts only private invite hash shape', () => {
    const entries = new Map<string,string>();
    const storage: Storage = { getItem: key => entries.get(key) ?? null, setItem: (key,value) => { entries.set(key,value); },
      get length() { return entries.size; }, clear: () => entries.clear(), removeItem: key => { entries.delete(key); }, key: i => [...entries.keys()][i] ?? null };
    const credentials = { roomId: 'b'.repeat(32), token: 'c'.repeat(64), seat: 2 as Seat };
    saveSeat(credentials, storage);
    expect(savedSeat(credentials.roomId,storage)).toEqual(credentials);
    expect(savedSeat('a'.repeat(32),storage)).toBeNull();
    expect(roomFromHash(`#room=${credentials.roomId}`)).toBe(credentials.roomId);
    expect(roomFromHash('#room=short')).toBeNull();
    expect(roomFromInput(roomCode(credentials.roomId), 'https://plunge.test')).toBe(credentials.roomId);
    expect(roomFromInput(`https://plunge.test/?rooms=1#room=${credentials.roomId}`, 'https://plunge.test')).toBe(credentials.roomId);
    expect(roomFromInput(`https://other.test/?rooms=1#room=${credentials.roomId}`, 'https://plunge.test')).toBeNull();
    expect(roomFromInput('nonsense', 'https://plunge.test')).toBeNull();
  });
});
