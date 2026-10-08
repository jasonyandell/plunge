import { describe, expect, it } from 'vitest';
import { legalActions, type Seat } from '../src/engine';
import { ClosedTable, commandRoom, createRoom, GRACE, joinRoom, knockRoom, roomSnapshot, settleRoom, type SavedRoom } from '../worker/rooms';
import type { ProposalKind, RoomCommand } from '../src/room/protocol';

const hostToken = 'b'.repeat(64), guestToken = 'c'.repeat(64), thirdToken = 'e'.repeat(64);
const pair = new Set<Seat>([0, 2]);
/** Propose, then let the clock settle whatever the table has not answered. */
function decide(room: SavedRoom, seat: Seat, kind: ProposalKind, connected: ReadonlySet<Seat>, now: number, target?: Seat) {
  const command: RoomCommand = { type: 'propose', id: `${kind}-${room.state.revision}`, revision: room.state.revision, kind, ...(target === undefined ? {} : { target }) };
  const status = commandRoom(room, seat, command, connected, now);
  settleRoom(room, connected, now + 5001);
  return status;
}
function fixture() {
  const room = createRoom('a'.repeat(32), 'Host', hostToken, 1000);
  expect(joinRoom(room, 'Guest', guestToken, 1000).seat).toBe(2);
  decide(room, 0, 'start', pair, 1000);
  expect(room.state.game).not.toBeNull();
  return room;
}
function move(room: SavedRoom, id = 'move'): RoomCommand {
  return { type: 'action', id, revision: room.state.revision, action: legalActions(room.state.game!)[0]! };
}
/** A person plays their own seat; the runner plays Walt's. */
const actorFor = (room: SavedRoom, turn: Seat, connected: ReadonlySet<Seat>) => room.players[turn] ? turn : ([0, 1, 2, 3] as const).find(s => room.players[s] && connected.has(s))!;

describe('family table without a host', () => {
  it('keeps keys private, seats the partner first, and lets someone sit down mid-hand', () => {
    const room = fixture(), snapshot = roomSnapshot(room, pair, 1000);
    expect(snapshot.seats[2]).toEqual({ name: 'Guest', connected: true, away: false });
    expect(snapshot.runner).toBe(0); expect(snapshot.open).toBe(true); expect(snapshot.proposal).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain(hostToken);
    expect(JSON.stringify(snapshot)).not.toContain(guestToken);
    expect(snapshot.game!.config.allPass).toBe('force-30');
    expect(snapshot.game!.config.nello).toBe('open');
    const game = room.state.game, revision = room.state.revision;
    expect(joinRoom(room, 'Late arrival', thirdToken, 1500).seat).toBe(1);
    expect(room.state.game).toBe(game); expect(room.state.revision).toBe(revision + 1);
    expect(roomSnapshot(room, pair, 1500).seats[1]).toEqual({ name: 'Late arrival', connected: false, away: false });
  });
  it('rejects wrong-seat, stale and illegal actions while duplicate success is idempotent', () => {
    const room = fixture(), turn = room.state.game!.turn!, command = move(room);
    const actor = actorFor(room, turn, pair);
    const wrong = actor === 2 ? 0 : 2;
    if (command.type !== 'action') throw new Error('unreachable');
    expect(() => commandRoom(room, wrong, command, pair, 1001)).toThrow(/not your turn/);
    expect(() => commandRoom(room, actor, { ...command, revision: -1 }, pair, 1001)).toThrow(/table changed/);
    expect(() => commandRoom(room, actor, { ...command, action: { type: 'play', domino: '66' } }, pair, 1001)).toThrow(/not legal/);
    expect(() => commandRoom(room, actor, { type: 'action', id: 'shake', revision: room.state.revision, action: { type: 'next-hand' } }, pair, 1001)).toThrow(/with the table/);
    const before = room.state.revision;
    expect(commandRoom(room, actor, command, pair, 1001)).toBe('changed');
    expect(room.state.revision).toBe(before + 1);
    expect(commandRoom(room, actor, command, pair, 1002)).toBe('duplicate');
    expect(room.state.revision).toBe(before + 1);
  });
  it('waits a grace for someone who dropped, then lets whoever is present run Walt for their seat', () => {
    const room = fixture();
    // Walk until it is the guest's turn, with the runner playing Walt's seats.
    let now = 2000, steps = 0;
    while (room.state.game!.turn !== 2) {
      const turn = room.state.game!.turn!;
      commandRoom(room, actorFor(room, turn, pair), move(room, `walk-${steps++}`), pair, now);
      now = Math.max(now, room.state.holdUntil) + 1;
      expect(steps).toBeLessThan(10);
    }
    const guestGone = new Set<Seat>([0]);
    expect(roomSnapshot(room, guestGone, now).seats[2]).toMatchObject({ connected: false, away: false });
    expect(() => commandRoom(room, 0, move(room), guestGone, now)).toThrow(/Waiting for Guest/);
    expect(() => commandRoom(room, 0, { type: 'thinking', id: 't', revision: room.state.revision, seat: 2 }, guestGone, now)).toThrow(/running Walt/);
    const later = now + GRACE;
    expect(roomSnapshot(room, guestGone, later).seats[2]).toMatchObject({ connected: false, away: true });
    expect(roomSnapshot(room, guestGone, later).runner).toBe(0);
    expect(commandRoom(room, 0, { type: 'thinking', id: 't', revision: room.state.revision, seat: 2 }, guestGone, later)).toBe('thinking');
    const humanSteps = room.humanSteps!.indices.length;
    expect(commandRoom(room, 0, move(room, 'for-guest'), guestGone, later)).toBe('changed');
    expect(room.humanSteps!.indices).toHaveLength(humanSteps); // Walt's move for Guest is not a human decision.
    expect(room.players[2]!.token).toBe(guestToken); // The seat stays theirs.
    // When the first seat is gone, the guest runs Walt instead; the absent host cannot.
    const hostGone = new Set<Seat>([2]);
    expect(roomSnapshot(room, hostGone, later + GRACE).runner).toBe(2);
    let at = Math.max(later, room.state.holdUntil) + GRACE;
    // The guest plays their own turns (a bid may be followed by their declaration) until a Walt seat is up.
    while (room.state.game!.turn === 2) { commandRoom(room, 2, move(room, `own-${room.state.revision}`), hostGone, at); at = Math.max(at, room.state.holdUntil) + 1; }
    expect(room.state.game!.turn).not.toBe(2);
    expect(() => commandRoom(room, 0, move(room, 'ghost'), hostGone, at)).toThrow(/not your turn/);
    expect(commandRoom(room, 2, move(room, 'runner'), hostGone, at)).toBe('changed');
  });
  it('settles start, undo and the next hand as quick votes: alone at once, together after the window or a veto', () => {
    const solo = createRoom('a'.repeat(32), 'Host', hostToken, 1000), only = new Set<Seat>([0]);
    expect(commandRoom(solo, 0, { type: 'propose', id: 'go', revision: 0, kind: 'start' }, only, 1000)).toBe('changed');
    expect(solo.state.game).not.toBeNull(); expect(solo.state.proposal).toBeNull();
    expect(solo.state.lastVote).toMatchObject({ kind: 'start', byName: 'Host', outcome: 'passed', revision: solo.state.revision });

    const room = fixture();
    let steps = 0, now = 2000;
    while (!room.players[room.state.game!.turn!]) { commandRoom(room, 0, move(room, `w${steps++}`), pair, now); now = Math.max(now, room.state.holdUntil) + 1; }
    const human = room.state.game!.turn!, before = structuredClone(room.state.game);
    commandRoom(room, human, move(room, 'human'), pair, now);
    expect(roomSnapshot(room, pair, now).canUndo).toBe(true);
    const other = human === 0 ? 2 : 0;
    expect(commandRoom(room, other, { type: 'propose', id: 'ask', revision: room.state.revision, kind: 'undo' }, pair, now)).toBe('changed');
    expect(room.state.proposal).toMatchObject({ kind: 'undo', by: other, mode: 'veto', votes: { [other]: 'yes' }, deadline: now + 5000 });
    expect(() => commandRoom(room, human, { type: 'propose', id: 'again', revision: room.state.revision, kind: 'undo' }, pair, now)).toThrow(/already deciding/);
    expect(() => commandRoom(room, human, { type: 'vote', id: 'late', proposal: 'nope', vote: 'yes' }, pair, now)).toThrow(/already closed/);
    expect(commandRoom(room, human, { type: 'vote', id: 'veto', proposal: 'ask', vote: 'no' }, pair, now + 1)).toBe('changed');
    expect(room.state.proposal).toBeNull(); expect(room.state.game).not.toEqual(before);
    expect(room.state.lastVote).toMatchObject({ kind: 'undo', outcome: 'failed', noFrom: room.players[human]!.name });
    expect(commandRoom(room, other, { type: 'propose', id: 'ask2', revision: room.state.revision, kind: 'undo' }, pair, now)).toBe('changed');
    expect(settleRoom(room, pair, now + 4999)).toBe(false);
    expect(settleRoom(room, pair, now + 5000)).toBe(true);
    expect(room.state.game).toEqual(before); expect(room.state.lastUndo).toMatchObject({ seat: human, revision: room.state.revision });
    expect(room.state.lastVote).toMatchObject({ kind: 'undo', outcome: 'passed' });
    expect(commandRoom(room, other, { type: 'propose', id: 'ask2', revision: 0, kind: 'undo' }, pair, now)).toBe('duplicate');
    // Early unanimous yes.
    commandRoom(room, human, move(room, 'human2'), pair, now + 6000);
    commandRoom(room, other, { type: 'propose', id: 'ask3', revision: room.state.revision, kind: 'undo' }, pair, now + 6001);
    expect(commandRoom(room, human, { type: 'vote', id: 'ok', proposal: 'ask3', vote: 'yes' }, pair, now + 6002)).toBe('changed');
    expect(room.state.game).toEqual(before); expect(room.state.proposal).toBeNull();
  });
  it('kicks by majority, lets people leave, and closes the table so newcomers knock', () => {
    const room = fixture(), three = new Set<Seat>([0, 1, 2]);
    expect(joinRoom(room, 'Third', thirdToken, 1000).seat).toBe(1);
    expect(() => commandRoom(room, 0, { type: 'propose', id: 'self', revision: room.state.revision, kind: 'kick', target: 0 }, three, 1000)).toThrow(/Leave/);
    expect(() => commandRoom(room, 0, { type: 'propose', id: 'walt', revision: room.state.revision, kind: 'kick', target: 3 }, three, 1000)).toThrow(/Walt/);
    commandRoom(room, 0, { type: 'propose', id: 'kick', revision: room.state.revision, kind: 'kick', target: 1 }, three, 1000);
    expect(room.state.proposal).toMatchObject({ kind: 'kick', target: 1, mode: 'allow' });
    expect(() => commandRoom(room, 1, { type: 'vote', id: 'plead', proposal: 'kick', vote: 'no' }, three, 1001)).toThrow(/rest of the table/);
    expect(settleRoom(room, three, 1000 + 10000)).toBe(true);
    expect(room.state.lastVote).toMatchObject({ kind: 'kick', outcome: 'failed' }); expect(room.players[1]).not.toBeNull();
    commandRoom(room, 0, { type: 'propose', id: 'kick2', revision: room.state.revision, kind: 'kick', target: 1 }, three, 1000);
    expect(commandRoom(room, 2, { type: 'vote', id: 'agree', proposal: 'kick2', vote: 'yes' }, three, 1001)).toBe('changed');
    expect(room.players[1]).toBeNull(); expect(room.former).toContainEqual({ token: thirdToken, reason: 'kicked' });
    expect(room.state.lastVote).toMatchObject({ kind: 'kick', outcome: 'passed', targetName: 'Third' });
    expect(() => commandRoom(room, 1, { type: 'leave', id: 'gone' }, three, 1002)).toThrow(/no longer yours/);
    expect(JSON.stringify(roomSnapshot(room, three, 1002))).not.toContain(thirdToken);

    expect(commandRoom(room, 2, { type: 'leave', id: 'bye' }, pair, 1003)).toBe('changed');
    expect(room.players[2]).toBeNull(); expect(room.former).toContainEqual({ token: guestToken, reason: 'left' });
    expect(roomSnapshot(room, new Set<Seat>([0]), 1003).runner).toBe(0);
    expect(joinRoom(room, 'Guest again', 'f'.repeat(64), 1004).seat).toBe(2);

    const only = new Set<Seat>([0]);
    expect(commandRoom(room, 0, { type: 'propose', id: 'close', revision: room.state.revision, kind: 'close' }, only, 1005)).toBe('changed');
    expect(room.state.open).toBe(false);
    expect(() => commandRoom(room, 0, { type: 'propose', id: 'close2', revision: room.state.revision, kind: 'close' }, only, 1005)).toThrow(/already closed/);
    expect(() => joinRoom(room, 'Stranger', '9'.repeat(64), 1006)).toThrow(ClosedTable);
    const visitor = '0123456789abcdef';
    expect(knockRoom(room, visitor, 'knock', 'Cousin', only, 1006)).toBe('changed');
    expect(room.state.proposal).toMatchObject({ kind: 'admit', by: null, byName: 'Cousin', knock: visitor, votes: {} });
    expect(knockRoom(room, visitor, 'knock', 'Cousin', only, 1007)).toBe('duplicate');
    expect(knockRoom(room, visitor, 'knock-again', 'Cousin', only, 1007)).toBe('duplicate');
    expect(() => knockRoom(room, 'fedcba9876543210', 'other', 'Neighbor', only, 1007)).toThrow(/deciding something else/);
    expect(() => joinRoom(room, 'Cousin', '8'.repeat(64), 1008, visitor)).toThrow(/closed/);
    expect(commandRoom(room, 0, { type: 'vote', id: 'door', proposal: 'knock', vote: 'yes' }, only, 1008)).toBe('changed');
    expect(room.state.lastVote).toMatchObject({ kind: 'admit', outcome: 'passed', knock: visitor });
    expect(() => joinRoom(room, 'Cousin', '8'.repeat(64), 1009, 'fedcba9876543210')).toThrow(/closed/);
    expect(joinRoom(room, 'Cousin', '8'.repeat(64), 1009, visitor).seat).toBe(1);
    expect(() => joinRoom(room, 'Cousin twin', '7'.repeat(64), 1010, visitor)).toThrow(/closed/);
    // A knock nobody answers fails at the deadline; an open table needs no knock.
    commandRoom(room, 1, { type: 'leave', id: 'cousin-bye' }, new Set<Seat>([0, 1]), 1012);
    knockRoom(room, 'fedcba9876543210', 'quiet', 'Neighbor', new Set<Seat>(), 1013);
    expect(settleRoom(room, new Set<Seat>(), 1013 + 59999)).toBe(false);
    expect(settleRoom(room, new Set<Seat>(), 1013 + 60000)).toBe(true);
    expect(room.state.lastVote).toMatchObject({ kind: 'admit', outcome: 'failed' });
    commandRoom(room, 0, { type: 'propose', id: 'open', revision: room.state.revision, kind: 'open' }, only, 1014);
    expect(room.state.open).toBe(true);
    expect(() => knockRoom(room, 'fedcba9876543210', 'needless', 'Neighbor', only, 1015)).toThrow(/open/);
  });
  it('completes a legal two-human hand, holds each trick, shakes the next hand by vote, and survives a save/reload', () => {
    const room = fixture(); let now = 2000, decisions = 0, holds = 0;
    while (!['hand-over', 'game-over'].includes(room.state.game!.phase)) {
      const game = room.state.game!, turn = game.turn!, actor = actorFor(room, turn, pair);
      const command = move(room, `move-${decisions}`);
      if (command.type === 'action' && command.action.type === 'play' && !room.players[turn]) command.receiptId = 'd'.repeat(64);
      const previousTricks = game.tricks.length;
      commandRoom(room, actor, command, pair, now);
      if (room.state.game!.tricks.length > previousTricks) {
        holds++;
        if (room.state.game!.phase === 'playing') {
          const next = move(room, 'too-fast'), nextTurn = room.state.game!.turn!;
          expect(() => commandRoom(room, actorFor(room, nextTurn, pair), next, pair, now + 1)).toThrow(/wait/);
        }
        now = room.state.holdUntil;
      }
      now++; decisions++;
      expect(decisions).toBeLessThan(40);
    }
    expect(holds).toBeGreaterThan(0);
    expect(room.state.nativeReceipts).not.toEqual({});
    const saved = JSON.parse(JSON.stringify(room)) as SavedRoom;
    expect(roomSnapshot(saved, pair, now)).toEqual(roomSnapshot(room, pair, now));
    if (saved.state.game!.phase === 'hand-over') {
      const oldHand = saved.state.game!.handNumber;
      expect(() => commandRoom(saved, 2, { type: 'action', id: 'next', revision: saved.state.revision, action: { type: 'next-hand' } }, pair, now)).toThrow(/with the table/);
      expect(decide(saved, 2, 'next-hand', pair, now)).toBe('changed');
      expect(saved.state.game!.handNumber).toBe(oldHand + 1);
      expect(() => decide(saved, 2, 'next-hand', pair, now + 6000)).toThrow(/not over/);
    } else {
      expect(decide(saved, 2, 'start', pair, now)).toBe('changed');
      expect(saved.state.game!.handNumber).toBe(1);
    }
  });
});
