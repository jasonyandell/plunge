/** Everything a mod may import besides preact, src/engine and its own folder.
 * tests/mod-boundary.test.ts holds mods to that. */
import type { ComponentType } from 'preact';
import type { GameState, Seat } from '../engine';

export { store, type ModStore } from './store';
export { Domino, dominoAriaLabel } from '../ui/Domino';
export { PIP_SUIT_NAMES, bidLabel, contractLabel, declLabel, ledChip, trumpChip } from '../ui/wording';

/** Read-only view of the table, from the viewer's chair. */
export interface TableSlotProps {
  game: GameState;
  /** The viewer's seat in `game` (the table always seats the viewer at the bottom). */
  seat: Seat;
}

export interface SlotProps {
  /** Just above your hand, at the bottom of the felt. */
  'table-above-hand': TableSlotProps;
}

export type SlotName = keyof SlotProps;
export type ModSlots = { [N in SlotName]?: ComponentType<SlotProps[N]> };

export interface ModManifest {
  id: string;
  title: string;
  summary: string;
  defaultOn: boolean;
  scope: 'device';
  slots: ModSlots;
}
