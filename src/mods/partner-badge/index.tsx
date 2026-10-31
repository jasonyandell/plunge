import type { ModManifest } from '../../kernel/mod-api';
import './partner-badge.css';

export const partnerBadge: ModManifest = {
  id: 'partner-badge',
  title: 'Partner badge',
  summary: 'Your partner’s name and a bold “Your partner” pill sit at the top of the table, so you always know who is on your side.',
  defaultOn: false,
  scope: 'device',
  slots: {},
};
