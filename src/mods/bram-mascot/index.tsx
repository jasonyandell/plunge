import type { ModManifest } from '../../kernel/mod-api';
import { Bram } from './Bram';

export const bramMascot: ModManifest = {
  id: 'bram-mascot',
  title: 'Bram mascot',
  summary: 'A cute chibi Bram, with silver curls and round glasses, stands by your hand to keep you company.',
  defaultOn: false,
  scope: 'device',
  slots: { 'table-above-hand': () => <Bram /> },
};
