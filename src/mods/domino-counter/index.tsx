import type { ModManifest } from '../../kernel/mod-api';
import { DominoCounter } from './DominoCounter';

export const dominoCounter: ModManifest = {
  id: 'domino-counter',
  title: 'Domino counter',
  summary: 'Fold out a list above your hand of the dominoes played in each suit, and how much count is gone.',
  defaultOn: false,
  scope: 'device',
  slots: { 'table-above-hand': ({ game }) => <DominoCounter g={game} /> },
};
