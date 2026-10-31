import type { ModManifest, SeatSlotProps } from '../../kernel/mod-api';

const sittingOut = ({ game, viewer }: SeatSlotProps) => game.sittingOut === viewer;

export const nelloSitoutView: ModManifest = {
  id: 'nello-sitout-view',
  title: 'See the hands while you sit out',
  summary: 'When your partner plays Nel-O and you sit out, the other three hands turn face up for you (playing alone only).',
  defaultOn: false,
  scope: 'device',
  slots: {
    'seat-reveal': sittingOut,
    'seat-note': p => p.relation === 'you' && sittingOut(p) ? 'Sitting out Nel-O: the other hands are face up.' : null,
  },
};
