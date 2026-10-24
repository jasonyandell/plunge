import { describe, expect, it } from 'vitest';
import { legalActions, newGame, PLUNGE_CONFIG, type Seat } from '../src/engine';
import { playerEvent, playerIdentity, playerKey } from '../src/ai/players';
import { describeProposal, describeResult } from '../src/room/VoteBar';
import { handsForGame } from '../src/history/review';
import { commandRoom, createRoom, joinRoom, PlungeRoom, settleRoom, type SavedRoom } from '../worker/rooms';
import { newProposal, VOTE_RULES } from '../worker/room-votes';
import type { IdeasDatabase } from '../worker/ideas';
import { handId, type HandEntry } from '../worker/stats';
import { finishedHand } from './hand-fixtures';

const both = new Set<Seat>([0, 2]);
function playingRoom(): SavedRoom {
  const room = createRoom('a'.repeat(32), 'Host', 'h'.repeat(64), 1000);
  joinRoom(room, 'Partner', 'p'.repeat(64), 1000);
  const game = finishedHand('switch-room', true, 6);
  room.state = { ...room.state, game, started: true, sessionId: 'switch-room', seed: 'switch-room',
    playerEvents: [playerEvent(game, 'native-partner')], nativeReceipts: { '1:0': 'saved-receipt' },
    thinkingSeat: game.turn, holdUntil: 3000, practiceHands: [1] };
  room.humanSteps = { handNumber: 1, indices: [0] };
  return room;
}
const propose = (room: SavedRoom, id = 'switch') => commandRoom(room, 0,
  { type: 'propose', id, revision: room.state.revision, kind: 'player', player: 'zeb', endGame: true }, both, 4000);
const vote = (room: SavedRoom, choice: 'yes' | 'no', proposal = 'switch') => commandRoom(room, 2,
  { type: 'vote', id: `${proposal}-${choice}`, proposal, vote: choice, endGame: true }, both, 4001);

describe('family model changes', () => {
  it('does nothing for the selected model and rejects an old client that never acknowledged ending the game', () => {
    const room = playingRoom(), state = room.state;
    expect(commandRoom(room, 0, { type: 'propose', id: 'same', revision: state.revision, kind: 'player', player: 'native-partner' }, both, 4000)).toBe('duplicate');
    expect(room.state).toBe(state);
    expect(() => commandRoom(room, 0, { type: 'propose', id: 'old-client', revision: state.revision, kind: 'player', player: 'zeb' }, both, 4000)).toThrow(/ends this game/);
    expect(room.state).toBe(state);
    propose(room);
    expect(() => commandRoom(room, 2, { type: 'vote', id: 'old-vote', proposal: 'switch', vote: 'yes' }, both, 4001)).toThrow(/vote ends the current game/);
    expect(room.state.game).toBe(state.game);
    expect(room.state.proposal!.votes).toEqual({ 0: 'yes' });
  });

  it('keeps the game when anyone declines, remains silent, or disconnects without agreeing', () => {
    for (const outcome of ['no', 'silence', 'disconnect'] as const) {
      const room = playingRoom(), game = room.state.game;
      propose(room);
      expect(room.state.proposal).toMatchObject({ mode: 'allow', needs: 'all', endsGame: true, electorate: [0, 2] });
      expect(describeProposal(room.state.proposal!)).toContain('end this game and switch to Zeb');
      if (outcome === 'no') vote(room, 'no');
      else {
        const present = outcome === 'disconnect' ? new Set<Seat>([0]) : both;
        expect(settleRoom(room, present, 4001)).toBe(false);
        expect(settleRoom(room, present, 4000 + VOTE_RULES.player.window)).toBe(true);
      }
      expect(room.state).toMatchObject({ player: 'native-partner', game, lastVote: { outcome: 'failed' } });
      expect(room.departedHands).toBeUndefined();
    }
  });

  it('ends the whole game on agreement, keeps seats and its history, and deals cleanly for the next model', () => {
    const room = playingRoom(), before = room.state, seats = structuredClone(room.players);
    propose(room);
    expect(room.state.game).toBe(before.game);
    vote(room, 'yes');
    expect(room.state).toMatchObject({ game: null, started: false, player: 'zeb', modelKey: playerKey('zeb'),
      seed: '', sessionId: '', thinkingSeat: null, holdUntil: 0, playerEvents: [], nativeReceipts: {}, decisionReceipts: {},
      auctionSurveys: {}, retry: null, practiceHands: [], lastUndo: null, lastVote: { outcome: 'passed', endsGame: true } });
    const identities = (r: SavedRoom['players']) => r.map(p => p ? { name: p.name, token: p.token, account: p.account } : null);
    expect(identities(room.players)).toEqual(identities(seats));
    expect(room.humanSteps).toBeUndefined();
    expect(room.departedHands).toHaveLength(1);
    expect(room.departedHands![0]).toMatchObject({ record: { gameId: 'switch-room', player: 'native-partner', models: [playerIdentity('native-partner')], gameOver: false },
      players: [{ seat: 0, name: 'Host' }, { seat: 2, name: 'Partner' }] });
    expect(describeResult(room.state.lastVote!)).toBe('Game ended · Zeb selected · Ready for a new game');
    expect(() => commandRoom(room, 0, { type: 'action', id: 'late-ai', revision: before.revision,
      action: legalActions(before.game!)[0]!, modelKey: playerKey('native-partner') }, both, 4002)).toThrow(/table changed/);
    commandRoom(room, 0, { type: 'propose', id: 'start', revision: room.state.revision, kind: 'start' }, both, 4003);
    vote(room, 'yes', 'start');
    expect(room.state.game!.hands).toEqual(newGame(PLUNGE_CONFIG, room.state.seed).hands);
    expect(room.state.game!.marks).toEqual([0, 0]);
    expect(room.state.game!.handNumber).toBe(1);
    expect(room.state.sessionId).not.toBe('switch-room');
    expect(room.state.playerEvents).toEqual([]);
  });

  it('does not turn a saved legacy veto proposal into permission to end a game', () => {
    const room = playingRoom(), game = room.state.game;
    room.state = { ...room.state, proposal: { ...newProposal('legacy', 'player', 0, 'Host', 1000, { player: 'zeb' }),
      mode: 'veto', deadline: 6000 } };
    expect(settleRoom(room, both, 6000)).toBe(true);
    expect(room.state).toMatchObject({ player: 'native-partner', game, lastVote: { outcome: 'moot' } });
    expect(room.departedHands).toBeUndefined();
  });

  it('preserves completed-hand archives while keeping the new model game journal empty', () => {
    const room = playingRoom(), completed = finishedHand('done-before-switch');
    const earlier = { sessionId: 'older-game', game: finishedHand('older-game'), names: ['A', 'B', 'C', 'D'], practice: false };
    room.state = { ...room.state, game: completed, recentHands: [earlier] };
    propose(room); vote(room, 'yes');
    const archive = room.state.recentHands!;
    expect(archive).toEqual([earlier, { sessionId: 'switch-room', game: completed,
      names: ['Host', 'Walt 2', 'Partner', 'Walt 4'], practice: true, models: [playerIdentity('native-partner')] }]);
    expect(archive[0]!.models).toBeUndefined();
    expect(handsForGame(archive, room.state.sessionId)).toEqual([]);
    expect(room.departedHands![0]!.record).toMatchObject({ gameId: 'switch-room', player: 'native-partner' });
    commandRoom(room, 0, { type: 'propose', id: 'start', revision: room.state.revision, kind: 'start' }, both, 4003);
    vote(room, 'yes', 'start');
    expect(room.state.player).toBe('zeb');
    expect(room.state.recentHands).toEqual(archive);
    expect(handsForGame(room.state.recentHands!, room.state.sessionId)).toEqual([]);
  });

  it('never assigns today’s model version to a legacy hand whose decisions lack recorded identities', () => {
    const room = playingRoom();
    room.state = { ...room.state, game: finishedHand('legacy-switch') };
    delete room.state.playerEvents;
    propose(room); vote(room, 'yes');
    expect(room.state.recentHands).toHaveLength(1);
    expect(room.state.recentHands![0]!.models).toBeUndefined();
    expect(room.state.player).toBe('zeb');
  });

  it('persists a departing hand with the new lobby, and retries the durable outbox after a database outage and restart', async () => {
    const room = playingRoom(); propose(room); vote(room, 'yes'); room.updated = Date.now();
    const queued = room.departedHands![0]!, durable = new Map<string, unknown>([['room', structuredClone(room)]]);
    let failOutbox = true, failDatabase = true, batches = 0;
    const storage = {
      async get<T>(key: string): Promise<T | undefined> { return structuredClone(durable.get(key)) as T | undefined; },
      async put(key: string, value: unknown) { if (key.startsWith('hand:') && failOutbox) throw new Error('Storage unavailable'); durable.set(key, structuredClone(value)); },
      async list<T>({ prefix }: { prefix: string }): Promise<Map<string, T>> { return new Map([...durable].filter(([key]) => key.startsWith(prefix))) as Map<string, T>; },
      async delete(keys: string[]) { keys.forEach(key => durable.delete(key)); return keys.length; },
      async setAlarm(_time: number) {}, async deleteAll() { durable.clear(); },
    };
    const context = { storage, blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn(), acceptWebSocket() {}, getWebSockets: () => [] };
    const database = { prepare: () => ({ bind() { return this; } }), async batch() { batches++; if (failDatabase) throw new Error('Database unavailable'); return []; } } as unknown as IdeasDatabase;
    // A restart after the lobby was saved still has the departing hand, even if its outbox write fails.
    await new PlungeRoom(context, { QUESTIONS: database }).alarm();
    expect((durable.get('room') as SavedRoom).departedHands).toEqual([queued]);
    failOutbox = false;
    await new PlungeRoom(context, { QUESTIONS: database }).alarm();
    expect((durable.get('room') as SavedRoom).departedHands).toEqual([]);
    expect(durable.get(`hand:${handId(queued)}`)).toEqual(queued);
    failDatabase = false;
    await new PlungeRoom(context, { QUESTIONS: database }).alarm();
    expect(batches).toBe(2);
    expect(await storage.list<HandEntry>({ prefix: 'hand:' })).toEqual(new Map());
    expect((durable.get('room') as SavedRoom).state).toMatchObject({ player: 'zeb', game: null, started: false });
  });
});
