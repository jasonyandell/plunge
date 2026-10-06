import { describe, expect, it } from 'vitest';
import { legalActions, type Seat } from '../src/engine';
import { commandRoom, createRoom, joinRoom, roomSnapshot } from '../worker/rooms';
import type { RoomCommand } from '../src/room/protocol';

const hostToken = 'b'.repeat(64), guestToken = 'c'.repeat(64);
const pair = new Set<Seat>([0, 2]);
function fixture() {
  const room = createRoom('a'.repeat(32), 'Host', hostToken, 1000);
  expect(joinRoom(room, 'Guest', guestToken, 1000).seat).toBe(2);
  commandRoom(room, 0, { type: 'start', id: 'start', revision: room.state.revision }, pair, 1000);
  return room;
}
function move(room: ReturnType<typeof fixture>, id = 'move'): RoomCommand {
  return { type: 'action', id, revision: room.state.revision, action: legalActions(room.state.game!)[0]! };
}

describe('trusted family room guards', () => {
  it('keeps keys private, assigns the partner first, and blocks mid-hand joins', () => {
    const room = fixture(), snapshot = roomSnapshot(room, pair);
    expect(snapshot.seats[2]).toEqual({ name: 'Guest', connected: true });
    expect(JSON.stringify(snapshot)).not.toContain(hostToken);
    expect(JSON.stringify(snapshot)).not.toContain(guestToken);
    expect(snapshot.game!.config.allPass).toBe('force-30');
    expect(snapshot.game!.config.nello).toBe('open');
    expect(() => joinRoom(room, 'Late arrival')).toThrow(/in progress/);
  });
  it('rejects wrong-seat, stale and illegal actions while duplicate success is idempotent', () => {
    const room = fixture(), turn = room.state.game!.turn!, command = move(room);
    const actor = room.players[turn] ? turn : 0;
    const wrong = actor === 2 ? 0 : 2;
    expect(() => commandRoom(room, wrong, command, pair, 1001)).toThrow(/not your turn/);
    expect(() => commandRoom(room, actor, { ...command, revision: -1 }, pair, 1001)).toThrow(/table changed/);
    expect(() => commandRoom(room, actor, { ...command, action: { type: 'play', domino: '66' } }, pair, 1001)).toThrow(/not legal/);
    const before = room.state.revision;
    expect(commandRoom(room, actor, command, pair, 1001)).toBe('changed');
    expect(room.state.revision).toBe(before + 1);
    expect(commandRoom(room, actor, command, pair, 1002)).toBe('duplicate');
    expect(room.state.revision).toBe(before + 1);
  });
  it('pauses for the host and other disconnected humans without replacing their seats', () => {
    const room = fixture(), command = move(room), turn = room.state.game!.turn!;
    const actor = room.players[turn] ? turn : 0;
    expect(() => commandRoom(room, actor, command, new Set([2]), 1001)).toThrow(/host disconnected/);
    expect(() => commandRoom(room, actor, command, new Set([0]), 1001)).toThrow(/player disconnected/);
    expect(room.players[2]!.token).toBe(guestToken);
    expect(commandRoom(room, actor, command, pair, 1002)).toBe('changed');
  });
  it('completes a legal two-human hand, holds each trick, and retains evidence through a save/reload', () => {
    const room = fixture(); let now = 2000, decisions = 0, holds = 0;
    while (!['hand-over', 'game-over'].includes(room.state.game!.phase)) {
      const game = room.state.game!, turn = game.turn!, actor = room.players[turn] ? turn : 0;
      const command = move(room, `move-${decisions}`);
      if (command.action!.type === 'play' && !room.players[turn]) command.receiptId = 'd'.repeat(64);
      const previousTricks = game.tricks.length;
      commandRoom(room, actor, command, pair, now);
      if (room.state.game!.tricks.length > previousTricks) {
        holds++;
        if (room.state.game!.phase === 'playing') {
          const next = move(room, 'too-fast'), nextTurn = room.state.game!.turn!;
          expect(() => commandRoom(room, room.players[nextTurn] ? nextTurn : 0, next, pair, now + 1)).toThrow(/wait/);
        }
        now = room.state.holdUntil;
      }
      now++; decisions++;
      expect(decisions).toBeLessThan(40);
    }
    expect(holds).toBeGreaterThan(0);
    expect(room.state.nativeReceipts).not.toEqual({});
    const saved = JSON.parse(JSON.stringify(room)) as typeof room;
    expect(roomSnapshot(saved, pair)).toEqual(roomSnapshot(room, pair));
    expect(() => commandRoom(saved, 2, { type: 'action', id: 'next', revision: saved.state.revision, action: { type: 'next-hand' } }, pair, now)).toThrow(/Only the host/);
    if (saved.state.game!.phase === 'hand-over') {
      const oldHand = saved.state.game!.handNumber;
      commandRoom(saved, 0, { type: 'action', id: 'next', revision: saved.state.revision, action: { type: 'next-hand' } }, pair, now);
      expect(saved.state.game!.handNumber).toBe(oldHand + 1);
    }
  });
});
