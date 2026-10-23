import { expect, it } from 'vitest';
import type { Seat } from '../src/engine';
import { commandRoom, createRoom, joinRoom, roomSnapshot } from '../worker/rooms';

const token = 'b'.repeat(64);
const lobby = () => createRoom('a'.repeat(32), 'Host', token, 1000, { account: 'host-account' });

it('moves to every open chair, preserves identity, and restores the chosen seat by account or key', () => {
  const room = lobby();
  let from: Seat = 0;
  for (const seat of [1, 2, 3, 0] as const) {
    const person = room.players[from];
    const command = { type: 'move-seat' as const, id: `chair-${seat}`, revision: room.state.revision, seat };
    expect(commandRoom(room, from, command, new Set([from]), 1100)).toBe('changed');
    expect(room.players[from]).toBeNull();
    expect(room.players[seat]).toBe(person);
    expect(room.state.game).toBeNull();
    expect(roomSnapshot(room, new Set([seat]), 1100).runner).toBe(seat);
    const revision = room.state.revision;
    expect(commandRoom(room, seat, command, new Set([seat]), 1101)).toBe('duplicate');
    expect(room.state.revision).toBe(revision);
    expect(joinRoom(room, 'Host', undefined, 1102, undefined, 'host-account').seat).toBe(seat);
    expect(joinRoom(room, 'Host', undefined, 1103, undefined, undefined, false, token, true)).toMatchObject({ seat, token });
    from = seat;
  }
});

it('protects reserved chairs, rejects stale or invalid requests, and locks seats during votes and games', () => {
  const room = createRoom('a'.repeat(32), 'Host', token, 1000);
  joinRoom(room, 'Guest', 'c'.repeat(64), 1000);
  const connected = new Set<Seat>([0, 2]);
  const move = (seat: Seat, revision = room.state.revision) => commandRoom(room, 0,
    { type: 'move-seat', id: `move-${seat}-${revision}`, revision, seat }, connected, 1100);
  expect(() => move(2)).toThrow(/reserved/);
  expect(() => move(4 as Seat)).toThrow(/four chairs/);
  expect(() => move(1, -1)).toThrow(/table changed/);
  commandRoom(room, 0, { type: 'propose', id: 'start', revision: room.state.revision, kind: 'start' }, connected, 1100);
  expect(() => move(1)).toThrow(/vote/);
  commandRoom(room, 2, { type: 'vote', id: 'agree', proposal: 'start', vote: 'yes' }, connected, 1101);
  const game = room.state.game;
  expect(game).not.toBeNull();
  expect(() => move(1)).toThrow(/before the game/);
  expect(room.state.game).toBe(game);
  expect(room.players.map(p => p?.name ?? null)).toEqual(['Host', null, 'Guest', null]);
});

it('lets only the first simultaneous request take an open chair', () => {
  const room = createRoom('a'.repeat(32), 'Host', token, 1000);
  joinRoom(room, 'Guest', 'c'.repeat(64), 1000);
  const revision = room.state.revision;
  commandRoom(room, 0, { type: 'move-seat', id: 'first', revision, seat: 1 }, new Set([0, 2]), 1100);
  expect(() => commandRoom(room, 2, { type: 'move-seat', id: 'second', revision, seat: 1 }, new Set([1, 2]), 1100)).toThrow(/table changed/);
  expect(room.players[1]?.name).toBe('Host');
  expect(room.players[2]?.name).toBe('Guest');
});
