import { effectivePlayer, playerId, playerLabel, playerVersion } from '../ai/players';
import type { GameState } from '../engine';
export function PlayerBadge({ selected, game }: { selected: unknown; game?: GameState | null }) {
  const actual = effectivePlayer(selected, game);
  return <span class="player-badge" title={playerVersion(actual)} aria-label={`Computer player: ${playerVersion(actual)}`}>
    {playerLabel(actual)}{actual !== playerId(selected) ? ` · Nel-O cover for ${playerLabel(selected)}` : ''}
  </span>;
}
