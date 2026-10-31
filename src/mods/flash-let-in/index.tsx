import type { ModManifest } from '../../kernel/mod-api';
import './flash-let-in.css';

export const flashLetIn: ModManifest = {
  id: 'flash-let-in',
  title: 'Flashing “Let them in”',
  summary: 'When someone knocks at a shared table, the Let them in button glows butterscotch and pulses twice so you notice.',
  category: 'family',
  details: 'At a shared table, when someone knocks to join, the Let them in button turns butterscotch and pulses twice. If your phone asks for less motion it glows without pulsing. From Rose’s idea on the ideas board (#81).',
  defaultOn: false,
  scope: 'device',
  slots: {},
};
