/**
 * Example hands for trying the review without any history, and for QA.
 * Played deterministically through the real engine by the practice player,
 * then shaped like the device records (growing history snapshots, a stats
 * log copy, an unfinished hand, and a record from a schema this build does
 * not know) so the example list exercises the same merge as real history.
 * Examples live only in memory and are always labelled as not yours.
 */
import { type GameState, LEGACY_PLUNGE_CONFIG, applyAction, newGame } from '../engine';
import { encodeReplay } from '../engine/replay-code';
import { finishHand } from './whatif';
import { handSteps } from './steps';
import type { SourceName } from './library';

export const EXAMPLE_PREFIX = 'example-';

function firstHand(seed: string, want: (g: GameState) => boolean): GameState {
  for (let i = 0; i < 400; i++) {
    const g = finishHand(newGame(LEGACY_PLUNGE_CONFIG, `${seed}-${i}`));
    if (want(g)) return g;
  }
  throw new Error(`No example hand for ${seed}.`);
}

function snapshot(g: GameState, gameId: string, minute: number) {
  return { schema: 'plunge-history-v1', gameId, handNumber: 1, code: encodeReplay(g),
    recordedAt: new Date(Date.UTC(2026, 8, 20, 19, minute)).toISOString() };
}

/** Raw example records, in the same shapes the device stores use. */
export function exampleRecords(): Array<{ source: SourceName; records: unknown[] }> {
  // You bid and played it out.
  const yours = firstHand('you-declare', g => g.declarer === 0 && !g.thrownIn && g.tricks.length >= 5);
  // You defended a contract that was set.
  const defended = firstHand('you-defend', g => g.declarer !== null && g.declarer % 2 === 1 && g.handResult?.made === false && g.tricks.length >= 4);
  const yoursId = `${EXAMPLE_PREFIX}you-bid`, defendId = `${EXAMPLE_PREFIX}you-defend`, openId = `${EXAMPLE_PREFIX}unfinished`;
  // Growing snapshots of one hand, as the recorder writes them after each action.
  const steps = handSteps(yours)!;
  const partial = steps.filter((_, i) => i % 6 === 0).map((s, i) => snapshot(s.state, yoursId, i));
  // An unfinished hand: stopped partway through trick 3.
  const stopped = handSteps(defended)!;
  const midway = stopped.slice(0, Math.min(stopped.length - 1, 14)).reduce((g, s) => applyAction(g, s.action), stopped[0]!.state);
  return [
    { source: 'example', records: [...partial, snapshot(yours, yoursId, 30), snapshot(defended, defendId, 50),
      snapshot(midway, openId, 55), { schema: 'plunge-history-v9', note: 'from a newer build — kept, not shown' }] },
    { source: 'example', records: [{ schema: 'plunge-hand-v1', id: `${defendId}:1`, gameId: defendId, handNumber: 1,
      code: encodeReplay(defended), endedAt: new Date(Date.UTC(2026, 8, 20, 19, 50)).toISOString() }] },
  ];
}
