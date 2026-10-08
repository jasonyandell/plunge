import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, newGame, PLUNGE_CONFIG, type GameState } from '../src/engine';
import { listHistory, recordHistory, snapshotOf } from '../src/history/recorder';
import { soloHandsFromHistory } from '../src/history/review';
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
    const hands = soloHandsFromHistory(await listHistory());
    expect(hands).toHaveLength(1);
    expect(hands[0]).toMatchObject({ sessionId: app.sessionId, names: SOLO_SEAT_NAMES, practice: false,
      game: { handNumber: 7, phase: 'game-over', marks: app.game.marks, winner: app.game.winner,
        dealt: app.game.dealt, bids: app.game.bids, tricks: app.game.tricks, handResult: app.game.handResult } });
  });

  it('excludes multiplayer, unfinished hands and unreadable replays', () => {
    const snapshot = snapshotOf(finishedApp())!;
    expect(soloHandsFromHistory([null, {}, { ...snapshot, room: { mode: 'shared-room' } },
      { ...snapshot, gameId: 'unfinished', phase: 'playing' },
      { ...snapshot, gameId: 'broken', code: 'bad replay' }])).toEqual([]);
  });

  it('hides an abandoned result until its newer attempt finishes, even if older writes arrive last', () => {
    const app = finishedApp(), snapshot = { ...snapshotOf(app)!, recordedAt: '2026-10-08T15:00:00Z' };
    const restarted = reducer(app, { type: 'restart-hand', epoch: app.epoch });
    expect(restarted.retry?.attempt).toBe(1);
    const retry = { ...snapshotOf(restarted)!, recordedAt: '2026-10-08T14:00:00Z' };
    expect(soloHandsFromHistory([retry, snapshot])).toEqual([]);
    const finishedRetry = { ...snapshotOf({ ...restarted, game: app.game })!, recordedAt: '2026-10-08T14:30:00Z' };
    const hands = soloHandsFromHistory([finishedRetry, retry, snapshot, finishedRetry]);
    expect(hands).toHaveLength(1);
    expect(hands[0]!.practice).toBe(true);
    expect(hands[0]!.game.tricks).toEqual(app.game.tricks);
  });

  it('keeps the most recent 20 results without conflating games on the same deal', () => {
    const snapshot = snapshotOf(finishedApp())!;
    const events = Array.from({ length: ROOM_HISTORY_LIMIT + 2 }, (_, index) => ({ ...snapshot,
      gameId: `game-${index}`, recordedAt: new Date(index * 1000).toISOString() }));
    const hands = soloHandsFromHistory(events.reverse());
    expect(hands).toHaveLength(ROOM_HISTORY_LIMIT);
    expect(hands[0]!.sessionId).toBe('game-2');
    expect(hands.at(-1)!.sessionId).toBe(`game-${ROOM_HISTORY_LIMIT + 1}`);
  });
});
