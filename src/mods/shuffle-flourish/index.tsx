import type { ModManifest } from '../../kernel/mod-api';
import { Flourish } from './Shuffle';

export const shuffleFlourish: ModManifest = {
  id: 'shuffle-flourish',
  title: 'Shuffle on each deal',
  summary: 'A couple on a tandem bike circles the dominoes for a moment at the start of each new hand.',
  defaultOn: false,
  scope: 'device',
  slots: { 'table-decor': p => <Flourish {...p} /> },
};
