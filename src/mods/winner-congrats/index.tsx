import type { ModManifest } from '../../kernel/mod-api';
import { VictoryPicture } from './VictoryPicture';
import './congrats.css';

export const winnerCongrats: ModManifest = {
  id: 'winner-congrats',
  title: 'Congratulations picture',
  summary: 'When the game ends, a picture of two teammates holding a Congratulations banner for the winning team.',
  defaultOn: false,
  scope: 'device',
  slots: { 'gameover-header': ({ won }) => <VictoryPicture won={won} /> },
};
