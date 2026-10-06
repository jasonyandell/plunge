import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, newGame, LEGACY_PLUNGE_CONFIG, type Seat } from '../src/engine';
import { rotateGame } from '../src/room/view';
import { initialApp } from '../src/ui/store';
import { recordHistory, listHistory, snapshotOf } from '../src/history/recorder';
import { listHands } from '../src/history/legacy';
import { roomFromHash, savedSeat, saveSeat } from '../src/room/client';

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
  });
});
