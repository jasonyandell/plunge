/** Reconstruct only this hand; existing saved rooms need no checkpoint snapshots. */
import { applyAction, PLUNGE_CONFIG, type GameState, type Seat } from '../src/engine';
import { handStartOf, handSteps } from '../src/engine/hand-history';
import { encodeReplay } from '../src/engine/replay-code';
import type { HandRetry } from '../src/ui/store';
import type { SavedRoom } from './rooms';

export function roomAuctionConfig(game: GameState): GameState {
  return (game.phase === 'bidding' || game.phase === 'declaring') && game.config.nello !== PLUNGE_CONFIG.nello
    ? { ...game, config: { ...game.config, nello: PLUNGE_CONFIG.nello } } : game;
}
function humanIndices(room: SavedRoom, game: GameState): number[] {
  if (room.humanSteps?.handNumber === game.handNumber) return room.humanSteps.indices;
  return handSteps(game).flatMap((step, index) => room.players[step.seat] ? [index] : []);
}
/** Preserve existing tokens, accepted ids, game/session identity and active contracts. */
export function upgradeRoom(room: SavedRoom): boolean {
  const game = room.state.game, upgraded = game ? roomAuctionConfig(game) : game;
  let changed = upgraded !== game || room.state.retry === undefined || room.state.practiceHands === undefined;
  if (game && room.humanSteps?.handNumber !== game.handNumber) {
    let indices: number[];
    try { indices = humanIndices(room, game); } catch { indices = []; }
    room.humanSteps = { handNumber: game.handNumber, indices }; changed = true;
  }
  if (changed) room.state = { ...room.state, game: upgraded, retry: room.state.retry ?? null,
    practiceHands: room.state.practiceHands ?? [] };
  return changed;
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item
  && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);

export function roomUndoTarget(room: SavedRoom): {
  game: GameState; kept: number; seat: Seat; retry: HandRetry; practiceHands: readonly number[];
  nativeReceipts: typeof room.state.nativeReceipts; auctionSurveys: typeof room.state.auctionSurveys;
} | null {
  const game = room.state.game;
  if (!game) return null;
  try {
    const steps = handSteps(game), humans = humanIndices(room, game);
    const kept = humans.filter(index => Number.isSafeInteger(index) && index >= 0 && index < steps.length).at(-1);
    if (kept === undefined) return null;
    const start = handStartOf(game);
    if (canonical(steps.reduce((at, step) => applyAction(at, step.action), start)) !== canonical(game)) return null;
    const restored = roomAuctionConfig(steps.slice(0, kept).reduce((at, step) => applyAction(at, step.action), start));
    const plays = restored.tricks.reduce((count, trick) => count + trick.plays.length, 0) + restored.currentTrick.length;
    const hand = `${game.handNumber}:`, removed = steps.slice(kept);
    const previous = room.state.retry?.handNumber === game.handNumber ? room.state.retry : null;
    const finished = game.phase === 'hand-over' || game.phase === 'game-over';
    const practice = room.state.practiceHands ?? [];
    return { game: restored, kept, seat: steps[kept]!.seat,
      nativeReceipts: Object.fromEntries(Object.entries(room.state.nativeReceipts)
        .filter(([key]) => !key.startsWith(hand) || Number(key.slice(hand.length)) < plays)),
      auctionSurveys: Object.fromEntries(Object.entries(room.state.auctionSurveys).filter(([key]) => !key.startsWith(hand)
        || (restored.bids.some(bid => key === `${hand}${bid.seat}`)
          && !removed.some(step => key === `${hand}${step.seat}` && (step.action.type === 'bid' || step.action.type === 'declare'))))),
      retry: { handNumber: game.handNumber, attempt: (previous?.attempt ?? 0) + 1, kind: 'undo', kept,
        from: { code: encodeReplay(game), phase: game.phase, marks: game.marks, handResult: game.handResult,
          winner: game.winner, thrownIn: game.thrownIn }, sawResult: (previous?.sawResult ?? false) || finished },
      practiceHands: practice.includes(game.handNumber) ? practice : [...practice, game.handNumber] };
  } catch { return null; }
}
