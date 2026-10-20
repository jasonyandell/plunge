import { expect, it } from 'vitest';
import { legalActions, type Seat } from '../src/engine';
import { commandRoom, createRoom, joinRoom, settleRoom } from '../worker/rooms';

const all = new Set<Seat>([0, 1, 2, 3]);
function completedHand() {
  const room = createRoom('a'.repeat(32), 'Host', 'b'.repeat(64), 1000);
  for (const name of ['Mom', 'Uncle', 'Dad']) joinRoom(room, name);
  commandRoom(room, 0, { type: 'propose', kind: 'start', id: 'start', revision: room.state.revision }, all, 1000);
  settleRoom(room, all, 6000);
  let now = 6001, moves = 0;
  while (room.state.game!.phase !== 'hand-over') {
    const game = room.state.game!;
    commandRoom(room, game.turn!, { type: 'action', action: legalActions(game)[0]!, id: `move-${moves++}`, revision: room.state.revision }, all, now);
    now = Math.max(now, room.state.holdUntil) + 1;
    expect(moves).toBeLessThan(40);
  }
  return { room, now };
}
it('holds the final trick, then keeps four players on the result until the fourth is ready, including reconnects', () => {
  const { room, now } = completedHand(), game = room.state.game;
  const ask = (id: string, at: number) => commandRoom(room, 0, { type: 'propose', kind: 'next-hand', id, revision: room.state.revision }, all, at);
  expect(() => ask('early', room.state.holdUntil - 1)).toThrow(/finish showing/);
  ask('next', now);
  const vote = (seat: Seat) => commandRoom(room, seat, { type: 'vote', id: `yes-${seat}`, proposal: 'next', vote: 'yes' }, all, now + 1);
  vote(2);
  expect(room.state.game).toBe(game);
  expect(settleRoom(room, new Set([0, 2]), now + 5000)).toBe(false);
  vote(1);
  expect(room.state.game).toBe(game);
  const restored = JSON.parse(JSON.stringify(room));
  expect(settleRoom(restored, all, now + 6000)).toBe(false);
  commandRoom(restored, 3, { type: 'vote', id: 'last-ready', proposal: 'next', vote: 'yes' }, all, now + 6001);
  expect(restored.state.game.handNumber).toBe(game!.handNumber + 1);
  expect(restored.state.recentHands.at(-1).game).toEqual(game);
});
it('does not advance on timeout, a legacy two-person vote, or an explicit departure', () => {
  for (const scenario of ['timeout', 'legacy', 'leave']) {
    const { room, now } = completedHand(), game = room.state.game;
    commandRoom(room, 0, { type: 'propose', kind: 'next-hand', id: 'next', revision: room.state.revision }, all, now);
    if (scenario === 'legacy') { room.state.proposal = { ...room.state.proposal!, needs: 'two', votes: { 0: 'yes', 2: 'yes' } }; delete room.state.proposal.electorate; }
    if (scenario === 'leave') commandRoom(room, 3, { type: 'leave', id: 'leave' }, all, now + 1);
    else settleRoom(room, all, now + 90000);
    expect(room.state.proposal).toBeNull();
    expect(room.state.game).toBe(game);
  }
});

it('starts a fresh readiness check when someone joins during the result', () => {
  const { room, now } = completedHand(), game = room.state.game;
  commandRoom(room, 3, { type: 'leave', id: 'leave' }, all, now);
  commandRoom(room, 0, { type: 'propose', kind: 'next-hand', id: 'next', revision: room.state.revision }, new Set([0, 1, 2]), now + 1);
  joinRoom(room, 'Newcomer', undefined, now + 2);
  expect(room.state.proposal).toBeNull();
  expect(room.state.game).toBe(game);
});
