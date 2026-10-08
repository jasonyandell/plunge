/** Read existing solo evidence without changing the save or replaying a live game. */
import { decodeReplay } from '../engine/replay-code';
import { ROOM_HISTORY_LIMIT, type RoomHand } from '../room/protocol';
import { SOLO_SEAT_NAMES } from '../ui/store';
import type { snapshotOf } from './recorder';

type Snapshot = NonNullable<ReturnType<typeof snapshotOf>> & { recordedAt?: string };
const finished = (phase: unknown) => phase === 'hand-over' || phase === 'game-over';

/** Scope the review before limiting it; older games stay in the underlying records. */
export function handsForGame(hands: readonly RoomHand[], sessionId: string): RoomHand[] {
  return hands.filter(hand => hand.sessionId === sessionId)
    .sort((a, b) => a.game.handNumber - b.game.handNumber).slice(-ROOM_HISTORY_LIMIT);
}

/** One final result per hand in this game, with later practice attempts superseding earlier results. */
export function soloHandsFromHistory(events: readonly unknown[], sessionId: string): RoomHand[] {
  const latest = new Map<string, Snapshot>();
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const snapshot = event as Snapshot;
    if (snapshot.schema !== 'plunge-history-v1' || snapshot.room || snapshot.gameId !== sessionId
      || !Number.isSafeInteger(snapshot.handNumber) || snapshot.handNumber < 1) continue;
    const key = `${snapshot.gameId}:${snapshot.handNumber}`, previous = latest.get(key);
    const attempt = snapshot.retry?.attempt ?? 0, previousAttempt = previous?.retry?.attempt ?? 0;
    // Writes can finish out of order. A takeback's later attempt always wins,
    // and within one attempt its completed result outranks intermediate plays.
    if (!previous || attempt > previousAttempt || (attempt === previousAttempt
      && (finished(snapshot.phase) && !finished(previous.phase)
        || finished(snapshot.phase) === finished(previous.phase) && (snapshot.recordedAt ?? '') >= (previous.recordedAt ?? '')))) {
      latest.set(key, snapshot);
    }
  }
  const hands: RoomHand[] = [];
  const snapshots = [...latest.values()].sort((a, b) => (a.recordedAt ?? '').localeCompare(b.recordedAt ?? '')
    || a.gameId.localeCompare(b.gameId) || a.handNumber - b.handNumber);
  for (const snapshot of snapshots) {
    if (!finished(snapshot.phase)) continue;
    const game = typeof snapshot.code === 'string' ? decodeReplay(snapshot.code) : snapshot.engineState;
    if (!game || !finished(game.phase) || !Array.isArray(snapshot.marks) || snapshot.marks.length !== 2
      || !snapshot.marks.every(mark => Number.isFinite(mark))) continue;
    hands.push({ sessionId: snapshot.gameId, names: [...SOLO_SEAT_NAMES],
      practice: !!snapshot.retry || !!snapshot.practiceHands?.includes(snapshot.handNumber),
      // Replay codes describe one deal; the recorder supplies its game context.
      game: { ...game, handNumber: snapshot.handNumber, marks: snapshot.marks, phase: snapshot.phase,
        winner: snapshot.winner, handResult: snapshot.handResult, thrownIn: snapshot.thrownIn },
    });
  }
  return handsForGame(hands, sessionId);
}
