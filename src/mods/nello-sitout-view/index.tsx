import type { ModManifest, SeatSlotProps } from '../../kernel/mod-api';

const sittingOut = ({ game, viewer }: SeatSlotProps) => game.sittingOut === viewer;

export const nelloSitoutView: ModManifest = {
  id: 'nello-sitout-view',
  title: 'See the hands while you sit out',
  summary: 'When your partner plays Nel-O and you sit out, the other three hands turn face up for you (playing alone only).',
  category: 'table',
  details: 'When your partner bids Nel-O and you sit the hand out, the other three hands turn face up so you can follow along, with a note under your seat. Only when you play alone with the computer players: at a shared table the other hands stay hidden. From Rose’s idea on the ideas board (#85).',
  defaultOn: false,
  scope: 'device',
  slots: {
    'seat-reveal': sittingOut,
    'seat-note': p => p.relation === 'you' && sittingOut(p) ? 'Sitting out Nel-O: the other hands are face up.' : null,
  },
};
