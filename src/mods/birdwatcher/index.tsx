import type { ModManifest } from '../../kernel/mod-api';
import { Birdwatch } from './Birdwatch';

export const birdwatcher: ModManifest = {
  id: 'birdwatcher',
  title: 'Birdwatcher',
  summary: 'If nobody moves for 20 seconds during play, a bird lands by your partner and a birdwatcher peeks in.',
  defaultOn: false,
  scope: 'device',
  slots: { 'table-decor': p => <Birdwatch {...p} /> },
};
