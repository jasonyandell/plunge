import type { ModManifest } from '../../kernel/mod-api';
import { DragHand } from './DragHand';

export const dragArrange: ModManifest = {
  id: 'drag-arrange',
  title: 'Arrange your dominoes',
  summary: 'Drag your dominoes into any order you like; tap one to play it as usual.',
  category: 'table',
  details: 'Your hand becomes one you can rearrange: drag a domino to a new spot and the order holds for the rest of the hand. A tap still plays it, and Show hints still marks what you can play. From Jason’s idea on the ideas board (#77).',
  defaultOn: false,
  scope: 'device',
  slots: { hand: DragHand },
};
