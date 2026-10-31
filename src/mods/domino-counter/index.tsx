import type { ModManifest } from '../../kernel/mod-api';
import { DominoCounter } from './DominoCounter';

export const dominoCounter: ModManifest = {
  id: 'domino-counter',
  title: 'Domino counter',
  summary: 'Fold out a list above your hand of the dominoes played in each suit, and how much count is gone.',
  category: 'help',
  details: 'Adds a fold-out list just above your hand of the dominoes played so far, grouped by the suits they can follow, and how much of the count is gone. It counts only what everyone has seen played, never anyone’s hand. From Jason’s idea on the ideas board (#84).',
  defaultOn: false,
  scope: 'device',
  slots: { 'table-above-hand': ({ game }) => <DominoCounter g={game} /> },
};
