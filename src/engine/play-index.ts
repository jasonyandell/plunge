import type { GameState } from './types';

/** Translate a physical play offset using the recorded trick boundaries. */
export function playLocation(g: GameState, ply: number): { trick: number; play: number } | null {
  if (!Number.isInteger(ply) || ply < 0) return null;
  const rows = [...g.tricks.map(t => t.plays), g.currentTrick];
  for (let trick = 0; trick < rows.length; trick++) {
    const size = rows[trick]!.length;
    if (ply < size) return { trick, play: ply };
    ply -= size;
  }
  return null;
}

export function playIndex(g: GameState, trick: number, play: number): number {
  const rows = [...g.tricks.map(t => t.plays), g.currentTrick];
  if (!Number.isInteger(trick) || !Number.isInteger(play) || trick < 0 || play < 0
    || !rows[trick] || play >= rows[trick]!.length) throw new Error('Invalid play position.');
  return rows.slice(0, trick).reduce((n, row) => n + row.length, 0) + play;
}
