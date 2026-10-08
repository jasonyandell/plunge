import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, newGame, PLUNGE_CONFIG, type GameState } from '../src/engine';
import { listHistory, recordHistory, snapshotOf } from '../src/history/recorder';
import { handsForGame, soloHandsFromHistory } from '../src/history/review';
import { ROOM_HISTORY_LIMIT } from '../src/room/protocol';
import { initialApp, reducer, SOLO_SEAT_NAMES } from '../src/ui/store';

function finishedApp() {
  let game: GameState = { ...newGame(PLUNGE_CONFIG, 'solo-review'), handNumber: 7, marks: [6, 6] };
  for (let step = 0; step < 40 && !['hand-over', 'game-over'].includes(game.phase); step++) {
    game = applyAction(game, legalActions(game)[0]!);
  }
  expect(game.phase).toBe('game-over');
  return { ...initialApp(), game, sessionId: 'solo-review' };
}

describe('solo prior hands', () => {
  it('reads existing recorder data with the original game score, number, names and tricks', async () => {
    const app = finishedApp();
    await recordHistory(app);
    const hands = soloHandsFromHistory(await listHistory(), app.sessionId);
    expect(hands).toHaveLength(1);
    expect(hands[0]).toMatchObject({ sessionId: app.sessionId, names: SOLO_SEAT_NAMES, practice: false,
      game: { handNumber: 7, phase: 'game-over', marks: app.game.marks, winner: app.game.winner,
        dealt: app.game.dealt, bids: app.game.bids, tricks: app.game.tricks, handResult: app.game.handResult } });
  });

  it('excludes multiplayer, unfinished hands and unreadable replays', () => {
    const snapshot = snapshotOf(finishedApp())!;
    expect(soloHandsFromHistory([null, {}, { ...snapshot, room: { mode: 'shared-room' } },
      { ...snapshot, handNumber: 8, phase: 'playing' },
      { ...snapshot, handNumber: 9, code: 'bad replay' }], snapshot.gameId)).toEqual([]);
  });

  it('hides an abandoned result until its newer attempt finishes, even if older writes arrive last', () => {
    const app = finishedApp(), snapshot = { ...snapshotOf(app)!, recordedAt: '2026-10-08T15:00:00Z' };
    const restarted = reducer(app, { type: 'restart-hand', epoch: app.epoch });
    expect(restarted.retry?.attempt).toBe(1);
    const retry = { ...snapshotOf(restarted)!, recordedAt: '2026-10-08T14:00:00Z' };
    expect(soloHandsFromHistory([retry, snapshot], app.sessionId)).toEqual([]);
    const finishedRetry = { ...snapshotOf({ ...restarted, game: app.game })!, recordedAt: '2026-10-08T14:30:00Z' };
    const hands = soloHandsFromHistory([finishedRetry, retry, snapshot, finishedRetry], app.sessionId);
    expect(hands).toHaveLength(1);
    expect(hands[0]!.practice).toBe(true);
    expect(hands[0]!.game.tricks).toEqual(app.game.tricks);
  });

  it('limits and orders hands within this game even when other games have newer records', () => {
    const snapshot = snapshotOf(finishedApp())!;
    const events = Array.from({ length: ROOM_HISTORY_LIMIT + 2 }, (_, index) => ({ ...snapshot,
      handNumber: index + 1, recordedAt: new Date((100 - index) * 1000).toISOString() }));
    const otherGames = events.map(event => ({ ...event, gameId: 'another-game', recordedAt: '2026-10-08T15:00:00Z' }));
    const hands = soloHandsFromHistory([...events.reverse(), ...otherGames], snapshot.gameId);
    expect(hands).toHaveLength(ROOM_HISTORY_LIMIT);
    expect(hands.every(hand => hand.sessionId === snapshot.gameId)).toBe(true);
    expect(hands[0]!.game.handNumber).toBe(3);
    expect(hands.at(-1)!.game.handNumber).toBe(ROOM_HISTORY_LIMIT + 2);
    expect(soloHandsFromHistory(events, 'new-game')).toEqual([]);
  });

  it('scopes shared review to the room’s current game without changing its saved archive', () => {
    const app = finishedApp();
    const old = { sessionId: 'previous-room-game', game: app.game, names: ['A', 'B', 'C', 'D'], practice: false };
    const current = { ...old, sessionId: 'current-room-game', game: { ...app.game, handNumber: 1 } };
    const archive = [old, current];
    expect(handsForGame(archive, current.sessionId)).toEqual([current]);
    expect(handsForGame(archive, 'restarted-room-game')).toEqual([]);
    expect(archive).toEqual([old, current]);
  });
});
