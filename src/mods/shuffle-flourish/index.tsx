import type { ModManifest } from '../../kernel/mod-api';
import { Flourish } from './Shuffle';

export const shuffleFlourish: ModManifest = {
  id: 'shuffle-flourish',
  title: 'Shuffle on each deal',
  summary: 'A couple on a tandem bike circles the dominoes for a moment at the start of each new hand.',
  category: 'looks',
  details: 'At the start of each new hand, a couple on a tandem bike rides a loop around the dominoes as they shuffle. If your phone asks for less motion, they just pause there a moment. From Scifigoofy’s idea on the ideas board (#62).',
  defaultOn: false,
  scope: 'device',
  slots: { 'table-decor': p => <Flourish {...p} /> },
};
