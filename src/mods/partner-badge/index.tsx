import type { ModManifest } from '../../kernel/mod-api';
import './partner-badge.css';

export const partnerBadge: ModManifest = {
  id: 'partner-badge',
  title: 'Partner badge',
  summary: 'Your partner’s name and a bold “Your partner” pill sit at the top of the table, so you always know who is on your side.',
  category: 'table',
  details: 'Makes your partner’s seat at the top of the table stand out: their name in bold and a teal “Your partner” pill. Nothing else moves. From Jason’s idea on the ideas board (#82).',
  defaultOn: false,
  scope: 'device',
  slots: {},
};
