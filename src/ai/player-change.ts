import type { GameState } from '../engine';
import { playerId, type PlayerId } from './players';

export type PlayerChange = { kind: 'unchanged' } | { kind: 'switch'; from: PlayerId; to: PlayerId; endsGame: boolean };

/** Pure policy shared by the picker, solo reducer and authoritative family table. */
export function planPlayerChange(current: unknown, next: PlayerId, game: Pick<GameState, 'phase'> | null): PlayerChange {
  const from = playerId(current);
  return from === next ? { kind: 'unchanged' }
    : { kind: 'switch', from, to: next, endsGame: game !== null && game.phase !== 'game-over' };
}
