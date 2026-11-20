import type { DominoId, GameState, Seat } from '../../engine';
import type { ModStore } from '../../kernel/mod-api';

/** Names this deal, so a saved order never outlives its hand. */
export const dealKey = (game: GameState, seat: Seat) => `${game.handNumber}:${(game.dealt[seat] ?? []).join(',')}`;

/** The hand in the player's order; tiles never arranged keep core's order after the rest. */
export const arranged = (hand: readonly DominoId[], order: readonly DominoId[]): DominoId[] =>
  [...order.filter(id => hand.includes(id)), ...hand.filter(id => !order.includes(id))];

/** `id` moved to `target` among the tiles in hand. Played tiles keep their place, so an undo puts them back. */
export function moved(order: readonly DominoId[], hand: readonly DominoId[], id: DominoId, target: number): DominoId[] {
  const shown = arranged(hand, order), from = shown.indexOf(id);
  if (from < 0 || target < 0 || target >= shown.length || from === target) return [...order];
  const next = shown.filter(tile => tile !== id);
  next.splice(target, 0, id);
  let i = 0;
  return [...order, ...hand.filter(tile => !order.includes(tile))].map(tile => hand.includes(tile) ? next[i++]! : tile);
}

/** Index of the slot whose center is nearest (x, y). */
export function nearest(slots: readonly { left: number; top: number; width: number; height: number }[], x: number, y: number): number {
  let best = -1, dist = Infinity;
  slots.forEach((s, i) => {
    const d = Math.hypot(x - (s.left + s.width / 2), y - (s.top + s.height / 2));
    if (d < dist) { dist = d; best = i; }
  });
  return best;
}

/** One saved order, for the current deal only. */
export function loadOrder(s: ModStore, deal: string): DominoId[] {
  const saved = s.get('order') as { deal?: unknown; order?: unknown } | null;
  return saved?.deal === deal && Array.isArray(saved.order) ? saved.order.filter((id): id is DominoId => typeof id === 'string') : [];
}
export const saveOrder = (s: ModStore, deal: string, order: readonly DominoId[]) => s.set('order', { deal, order });
