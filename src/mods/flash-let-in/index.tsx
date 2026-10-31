import type { ModManifest } from '../../kernel/mod-api';
import './flash-let-in.css';

export const flashLetIn: ModManifest = {
  id: 'flash-let-in',
  title: 'Flashing “Let them in”',
  summary: 'When someone knocks at a shared table, the Let them in button glows butterscotch and pulses twice so you notice.',
  defaultOn: false,
  scope: 'device',
  slots: {},
};
