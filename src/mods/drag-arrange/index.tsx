import type { ModManifest } from '../../kernel/mod-api';
import { DragHand } from './DragHand';

export const dragArrange: ModManifest = {
  id: 'drag-arrange',
  title: 'Arrange your dominoes',
  summary: 'Drag your dominoes into any order you like; tap one to play it as usual.',
  defaultOn: false,
  scope: 'device',
  slots: { hand: DragHand },
};
