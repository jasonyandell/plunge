import type { ModManifest } from '../../kernel/mod-api';
import './red-background.css';

export const redBackground: ModManifest = {
  id: 'red-background',
  title: 'Red background',
  summary: 'Swaps the walnut backdrop behind the table for a deep red one.',
  defaultOn: false,
  scope: 'device',
  slots: {},
};
