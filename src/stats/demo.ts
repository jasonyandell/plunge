import { applyAction, legalActions, newGame, PLUNGE_CONFIG, type Seat } from '../engine';
import { handRecordOf } from '../history/legacy';
import type { SavedHand } from './model';

/** Clearly labeled, deterministic sample play. Never enters the real hand log or uploads. */
export function demoHands(): SavedHand[] {
  return Array.from({ length: 9 }, (_, i) => {
    let game = newGame(PLUNGE_CONFIG, `stats-demo-${Math.floor(i / 2)}`);
    for (let n = 0; n < (i === 8 ? 7 : 200) && game.phase !== 'hand-over' && game.phase !== 'game-over'; n++) {
      const actions = legalActions(game);
      const choice = game.phase === 'bidding' && game.bids.length === 0
        ? (i === 4 ? actions.find(a => a.type === 'bid' && a.bid.kind === 'marks' && a.bid.special === 'nello') : undefined)
          ?? actions.find(a => a.type === 'bid' && a.bid.kind === 'points') ?? actions[0]!
        : game.phase === 'playing' && i % 2 ? actions[actions.length - 1]! : actions[0]!;
      game = applyAction(game, choice);
    }
    const record = handRecordOf(game, `demo-${i}${i === 7 ? '-r1' : ''}`, 'demo')!;
    return { id: `demo:${i}`, record: { ...record, endedAt: `2026-10-${String(10 + i).padStart(2, '0')}T12:00:00.000Z` },
      players: [{ seat: 0 as Seat, name: i % 2 ? 'Demo Ruby' : 'Demo Earl' }] };
  });
}
