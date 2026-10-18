import type { GameState } from '../engine';
import { catalogueDeal } from './catalogue';
import { usesPreparedDeals } from './players';

/** Both solo and family games deal from the selected player's supported source. */
export function dealForPlayer(game: GameState, seed: string, model: unknown): GameState {
  return usesPreparedDeals(model) ? catalogueDeal(game, seed) : game;
}
