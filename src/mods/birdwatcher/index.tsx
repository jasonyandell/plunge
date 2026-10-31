import type { ModManifest } from '../../kernel/mod-api';
import { Birdwatch } from './Birdwatch';

export const birdwatcher: ModManifest = {
  id: 'birdwatcher',
  title: 'Birdwatcher',
  summary: 'If nobody moves for 20 seconds during play, a bird lands by your partner and a birdwatcher peeks in.',
  category: 'looks',
  details: 'If nobody moves for 20 seconds during a hand, a bird lands by your partner’s seat and a birdwatcher peeks in from the side. Any tap starts the wait over, and they stay away while a menu or sheet is open. From Scifigoofy’s idea on the ideas board (#62).',
  defaultOn: false,
  scope: 'device',
  slots: { 'table-decor': p => <Birdwatch {...p} /> },
};
