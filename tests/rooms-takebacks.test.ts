import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, newDealtGame, newGame, PLUNGE_CONFIG, LEGACY_PLUNGE_CONFIG,
  type Action, type GameState, type Seat } from '../src/engine';
import { decodeReplay } from '../src/engine/replay-code';
import { handSteps } from '../src/engine/hand-history';
import { idOfTile } from '../src/ai/walt/requests';
import { commandRoom, createRoom, joinRoom, roomSnapshot, settleRoom, type SavedRoom } from '../worker/rooms';
import { roomUndoTarget, upgradeRoom } from '../worker/room-undo';
import fixtures from './fixtures/nello.json';

const pass: Action = { type: 'bid', bid: { kind: 'pass' } };
const receipt = 'd'.repeat(64);
function withGame(game: GameState, humans: readonly Seat[] = [0, 2]): SavedRoom {
  const room = createRoom('a'.repeat(32), 'Host', 'b'.repeat(64), 1000);
  for (const seat of humans) if (seat !== 0) room.players[seat] = { name: `Person ${seat}`, token: String(seat).repeat(64), seen: 1000 };
  room.state = { ...room.state, game, seed: 'takeback-test', sessionId: 'session-test', started: true };
  upgradeRoom(room); return room;
}
const connected = (room: SavedRoom) => new Set(room.players.flatMap((player, seat) => player ? [seat as Seat] : []));
const playing = (room: SavedRoom) => room.state.game?.phase === 'playing';
/** Anyone may ask; the table has five seconds to object, then the clock settles it. */
function decide(room: SavedRoom, kind: 'undo' | 'next-hand', id: string, now: number) {
  const status = commandRoom(room, 0, { type: 'propose', id, revision: room.state.revision, kind }, connected(room), now);
  settleRoom(room, connected(room), now + 5001);
  return status;
}
function take(room: SavedRoom, action: Action = legalActions(room.state.game!)[0]!) {
  const game = room.state.game!, now = Math.max(2000, room.state.holdUntil + 1);
  if (action.type === 'next-hand') { decide(room, 'next-hand', `next-${room.state.revision}`, now); return null; }
  const seat = game.turn!;
  const command = { type: 'action' as const, id: `move-${room.state.revision}`, revision: room.state.revision, action,
    ...(action.type === 'play' && !room.players[seat] ? { receiptId: receipt } : {}) };
  // The lowest present person runs Walt: seat 0 in every fixture here.
  commandRoom(room, room.players[seat] ? seat : 0, command, connected(room), now);
  return command;
}
function undo(room: SavedRoom, id = `undo-${room.state.revision}`) {
  return decide(room, 'undo', id, 2000);
}
function opening() {
  const dealt = newGame(PLUNGE_CONFIG, 'takeback-test').dealt;
  const room = withGame(newDealtGame(PLUNGE_CONFIG, dealt, 1)); // Guest seat 2 bids first.
  take(room, { type: 'bid', bid: { kind: 'points', value: 30 } });
  for (let i = 0; i < 3; i++) take(room, pass);
  take(room, { type: 'declare', decl: { type: 'pip', pip: 6 } });
  return room;
}

describe('host takebacks', () => {
  it('takes back the latest human decision and every later Walt reply, including during thinking or a trick hold', () => {
    const room = opening(), before = structuredClone(room.state.game);
    const human = take(room)!; // Guest lead.
    take(room); // Walt's reply.
    const at = room.state.game!;
    expect(at.currentTrick).toHaveLength(2);
    room.state.nativeReceipts['0:5'] = 'e'.repeat(64);
    const abandoned = structuredClone(room.state);
    room.state = { ...room.state, thinkingSeat: 1, holdUntil: 999999 };
    expect(roomSnapshot(room, connected(room)).canUndo).toBe(true);
    const oldRevision = room.state.revision;
    expect(undo(room)).toBe('changed'); // One revision asks, one settles.
    expect(room.state.game).toEqual(before);
    expect(room.state.revision).toBe(oldRevision + 2);
    expect(room.state.thinkingSeat).toBeNull(); expect(room.state.holdUntil).toBe(0);
    expect(room.state.nativeReceipts).toEqual({ '0:5': 'e'.repeat(64) });
    expect(abandoned.nativeReceipts['1:1']).toBe(receipt);
    expect(room.state.retry).toMatchObject({ handNumber: 1, attempt: 1, kind: 'undo', kept: 5, sawResult: false });
    expect(room.state.practiceHands).toEqual([1]);
    expect(room.state.lastUndo).toEqual({ revision: oldRevision + 2, seat: 2, name: 'Person 2' });
    expect(commandRoom(room, 2, human, connected(room), 2000)).toBe('duplicate');
    expect(room.state.game).toEqual(before);
  });
  it('uses monotonic revisions and retained request ids across reload, double taps, and delayed Walt work', () => {
    const room = opening(); take(room); take(room);
    const command = { type: 'propose' as const, kind: 'undo' as const, id: 'undo-request', revision: room.state.revision };
    const delayed = { type: 'action' as const, id: 'late-walt', revision: room.state.revision,
      action: legalActions(room.state.game!)[0]! };
    commandRoom(room, 0, command, connected(room), 2000);
    settleRoom(room, connected(room), 7001);
    const restored = JSON.parse(JSON.stringify(room)) as SavedRoom;
    const revision = restored.state.revision, game = structuredClone(restored.state.game);
    expect(commandRoom(restored, 0, command, connected(restored), 2000)).toBe('duplicate');
    expect(restored.state.revision).toBe(revision);
    expect(() => commandRoom(restored, 0, { ...command, id: 'second-tap' }, connected(restored), 2000)).toThrow(/table changed/);
    expect(() => commandRoom(restored, 0, delayed, connected(restored), 2000)).toThrow(/table changed/);
    expect(restored.state.game).toEqual(game);
    undo(restored);
    expect(restored.state.retry?.attempt).toBe(2);
    expect(restored.state.game?.phase).toBe('declaring');
    expect(restored.state.game?.turn).toBe(2);
    undo(restored); // Undo host's earlier pass; Walt's following pass leaves too.
    expect(restored.state.game?.phase).toBe('bidding'); expect(restored.state.game?.turn).toBe(0);
    undo(restored); // Undo the opening guest bid.
    expect(restored.state.game?.turn).toBe(2); expect(restored.state.game?.bids).toEqual([]);
    expect(roomSnapshot(restored, connected(restored)).canUndo).toBe(false);
    expect(() => undo(restored)).toThrow(/no human move/);
    expect(restored.accepted).toContain('0:undo-request');
  });
  it('restores pre-result marks and keeps prior attempt evidence, but cannot reach a previous hand', () => {
    const room = opening(); let checkpoint = structuredClone(room.state.game), steps = 0;
    room.state.game = { ...room.state.game!, marks: [6, 6] };
    while (playing(room)) {
      if (room.players[room.state.game!.turn!]) checkpoint = structuredClone(room.state.game);
      take(room); expect(++steps).toBeLessThan(29);
    }
    expect(room.state.game!.phase).toBe('game-over');
    const result = structuredClone(room.state.game!), originalSession = room.state.sessionId;
    undo(room);
    expect(room.state.game).toEqual(checkpoint);
    expect(room.state.game!.marks).toEqual([6, 6]); expect(room.state.game!.winner).toBeNull();
    expect(room.state.retry).toMatchObject({ sawResult: true, from: { marks: result.marks, handResult: result.handResult, winner: result.winner } });
    expect(room.state.sessionId).toBe(originalSession);
    while (playing(room)) take(room);
    expect(room.state.game).toEqual(result);
    undo(room); expect(room.state.retry).toMatchObject({ attempt: 2, sawResult: true });

    const nextRoom = opening(); while (playing(nextRoom)) take(nextRoom);
    undo(nextRoom);
    expect(nextRoom.state.recentHands ?? []).toEqual([]);
    while (playing(nextRoom)) take(nextRoom);
    const finalHand = structuredClone(nextRoom.state.game);
    take(nextRoom, { type: 'next-hand' });
    expect(nextRoom.state.recentHands).toHaveLength(1);
    expect(nextRoom.state.recentHands![0]).toMatchObject({ game: finalHand, practice: true });
    expect(nextRoom.state.game!.handNumber).toBe(2); expect(nextRoom.state.game!.config.nello).toBe('open');
    expect(nextRoom.state.retry).toBeNull(); expect(nextRoom.state.lastUndo).toBeNull();
    expect(nextRoom.state.practiceHands).toEqual([1]);
    expect(roomSnapshot(nextRoom, connected(nextRoom)).canUndo).toBe(false);
    expect(() => undo(nextRoom)).toThrow(/no human move/);
  });
  it('keeps the declaration receipt only while that auction decision remains in the live branch', () => {
    const room = opening();
    const evidence = { schema: 'walt-auction-v1', seat: 2 } as unknown as NonNullable<SavedRoom['state']['auctionSurveys']['1:2']>;
    room.state.auctionSurveys = { '0:2': evidence, '1:2': evidence };
    undo(room); // Guest's declaration is undone; its bid still exists.
    expect(room.state.game!.phase).toBe('declaring');
    expect(room.state.auctionSurveys).toEqual({ '0:2': evidence });
  });
});

describe('saved room upgrades', () => {
  it('recovers existing human decisions without changing active contracts, room keys or accepted actions', () => {
    let game = newDealtGame(LEGACY_PLUNGE_CONFIG, newGame(LEGACY_PLUNGE_CONFIG, 'old-room').dealt, 1);
    game = applyAction(game, { type: 'bid', bid: { kind: 'points', value: 30 } });
    for (let i = 0; i < 3; i++) game = applyAction(game, pass);
    game = applyAction(game, { type: 'declare', decl: { type: 'no-trump' } });
    const checkpoint = structuredClone(game);
    game = applyAction(game, legalActions(game)[0]!); game = applyAction(game, legalActions(game)[0]!);
    const room = withGame(game);
    delete room.humanSteps; delete room.state.retry; delete room.state.practiceHands; delete room.state.lastUndo;
    room.accepted = ['2:old-human', '0:old-walt'];
    const previous = JSON.parse(JSON.stringify(room)) as SavedRoom;
    expect(upgradeRoom(room)).toBe(true); expect(upgradeRoom(room)).toBe(false);
    expect(room.state.game).toEqual(previous.state.game); expect(room.state.game!.config.nello).toBe('off');
    expect(room.players).toEqual(previous.players); expect(room.accepted).toEqual(previous.accepted);
    expect(room.state.sessionId).toBe(previous.state.sessionId);
    expect(roomSnapshot(room, connected(room)).canUndo).toBe(true);
    undo(room); expect(room.state.game).toEqual(checkpoint);
    expect(room.accepted).toEqual([...previous.accepted, '0:undo-0']);
  });
  it('opens Nel-O only in existing auctions and the next hand, and avoids treating a new guest as an old Walt decision', () => {
    const old = newDealtGame(LEGACY_PLUNGE_CONFIG, newGame(LEGACY_PLUNGE_CONFIG, 'old-auction').dealt, 1);
    const auction = withGame(applyAction(old, { type: 'bid', bid: { kind: 'marks', value: 1 } }));
    for (let i = 0; i < 3; i++) take(auction, pass);
    expect(legalActions(auction.state.game!)).toContainEqual({ type: 'declare', decl: { type: 'nello' } });
    expect(auction.state.game!.dealt).toEqual(old.dealt);

    const room = opening(); while (playing(room)) take(room);
    delete room.humanSteps; // Emulate an old completed room before the new guest arrives.
    const target = roomUndoTarget(room)!;
    expect(joinRoom(room, 'New guest').seat).toBe(1);
    expect(roomUndoTarget(room)?.seat).toBe(target.seat);
    expect(roomUndoTarget(room)?.kept).toBe(target.kept);
    take(room, { type: 'next-hand' }); expect(room.state.game!.config.nello).toBe('open');
  });
});

describe('room declarations at every physical seat', () => {
  it('keeps a computer bidder and inactive computer partner canonical through Nel-O and a human takeback', () => {
    const fixture = fixtures.find(f => f.declarer === 1 && f.kind === 'make')!;
    const original = decodeReplay(fixture.replay)!;
    const room = withGame(newDealtGame(PLUNGE_CONFIG, original.dealt, original.shaker));
    expect(room.players[1]).toBeNull(); expect(room.players[3]).toBeNull();
    take(room, { type: 'bid', bid: { kind: 'marks', value: 1 } });
    for (let i = 0; i < 3; i++) take(room, pass);
    // The coordinator accepts the host's legal computer action; Walt's own
    // auction continues to select its existing straight-42 declarations.
    take(room, { type: 'declare', decl: { type: 'nello' } });
    expect(room.state.game!.sittingOut).toBe(3);
    let humanCheckpoint = structuredClone(room.state.game);
    for (let i = 0; i < fixture.plays.length; i += 2) {
      const game = room.state.game!;
      expect(game.turn).toBe(fixture.plays[i]); expect(game.turn).not.toBe(3);
      if (room.players[game.turn!]) humanCheckpoint = structuredClone(game);
      take(room, { type: 'play', domino: idOfTile(fixture.plays[i + 1]!) });
    }
    expect(room.state.game!.handResult!.made).toBe(true);
    expect(room.state.game!.hands[3]).toHaveLength(7);
    expect(room.state.nativeReceipts).not.toEqual({});
    undo(room);
    expect(room.state.game).toEqual(humanCheckpoint);
    expect(room.state.retry!.sawResult).toBe(true);
  });
  it.each([0, 1, 2, 3] as const)('keeps ordinary trump bidding and play legal for bidder %s', bidder => {
    const shaker = ((bidder + 3) % 4) as Seat;
    const room = withGame(newDealtGame(PLUNGE_CONFIG, newGame(PLUNGE_CONFIG, `normal-${bidder}`).dealt, shaker), [0, 1, 2, 3]);
    take(room, { type: 'bid', bid: { kind: 'marks', value: 1 } });
    for (let i = 0; i < 3; i++) take(room, pass);
    expect(room.state.game!.turn).toBe(bidder);
    take(room, { type: 'declare', decl: { type: 'pip', pip: 6 } });
    expect(room.state.game!.sittingOut).toBeNull();
    let moves = 0;
    while (playing(room)) { take(room); expect(++moves).toBeLessThan(29); }
    expect(room.state.game!.handResult!.marks).toBe(1);
    expect(room.state.game!.tricks.every(trick => trick.plays.length === 4)).toBe(true);
  });
  it.each(fixtures)('plays human Nel-O $kind at physical seat $declarer, retaining sitter tiles and takebacks', fixture => {
    const original = decodeReplay(fixture.replay)!;
    const initial = { ...newDealtGame(PLUNGE_CONFIG, original.dealt, original.shaker), marks: [6, 6] as const };
    const room = withGame(initial, [0, 1, 2, 3]);
    take(room, { type: 'bid', bid: { kind: 'marks', value: 1 } });
    for (let i = 0; i < 3; i++) take(room, pass);
    expect(room.state.game!.turn).toBe(fixture.declarer);
    take(room, { type: 'declare', decl: { type: 'nello' } });
    const sitter = ((fixture.declarer + 2) % 4) as Seat;
    expect(room.state.game!.sittingOut).toBe(sitter);
    let checkpoint = room.state.game!;
    for (let i = 0; i < fixture.plays.length; i += 2) {
      expect(room.state.game!.turn).toBe(fixture.plays[i]); expect(room.state.game!.turn).not.toBe(sitter);
      checkpoint = structuredClone(room.state.game!);
      take(room, { type: 'play', domino: idOfTile(fixture.plays[i + 1]!) });
      expect(room.state.game!.hands[sitter]).toHaveLength(7);
    }
    const result = structuredClone(room.state.game!);
    expect(result.phase).toBe('game-over'); expect(result.points).toEqual(fixture.points);
    expect(result.tricks.map(trick => trick.winner)).toEqual(fixture.winners);
    expect(result.tricks.every(trick => trick.plays.length === 3)).toBe(true);
    expect(result.handResult!.made).toBe(fixture.kind === 'make');
    expect(result.marks[result.handResult!.team]).toBe(7); expect(result.winner).toBe(result.handResult!.team);
    expect(handSteps(result)).toHaveLength(5 + fixture.plays.length / 2);
    const finalAction = { type: 'play', domino: idOfTile(fixture.plays.at(-1)!) } as const;
    undo(room); expect(room.state.game).toEqual(checkpoint);
    expect(room.state.retry?.sawResult).toBe(true); expect(room.state.game!.marks).toEqual([6, 6]);
    take(room, finalAction); expect(room.state.game).toEqual(result);
    const reloaded = JSON.parse(JSON.stringify(room)) as SavedRoom;
    undo(reloaded); expect(reloaded.state.retry?.attempt).toBe(2); expect(reloaded.state.game).toEqual(checkpoint);
  });
});
