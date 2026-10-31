import type { ModManifest } from '../../kernel/mod-api';
import { VictoryPicture } from './VictoryPicture';
import './congrats.css';

export const winnerCongrats: ModManifest = {
  id: 'winner-congrats',
  title: 'Congratulations picture',
  summary: 'When the game ends, a picture of two teammates holding a Congratulations banner for the winning team.',
  category: 'looks',
  details: 'When a game ends, the game-over card opens with a drawing of two teammates holding up a Congratulations banner for the team that won. From Scifigoofy’s idea on the ideas board (#62).',
  defaultOn: false,
  scope: 'device',
  slots: { 'gameover-header': ({ won }) => <VictoryPicture won={won} /> },
};
