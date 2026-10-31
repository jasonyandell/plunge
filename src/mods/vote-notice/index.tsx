import type { ModManifest, VoteSlotProps } from '../../kernel/mod-api';
import './vote-notice.css';

const Heading = ({ proposal }: VoteSlotProps) => proposal.kind === 'player'
  ? <span class="vote-notice-heading">Computer player vote</span> : null;
const Status = ({ proposal, mine }: VoteSlotProps) => proposal.kind === 'player' && mine === 'yes'
  ? <span class="vote-notice-status">Waiting for the table</span> : null;

export const voteNotice: ModManifest = {
  id: 'vote-notice',
  title: 'Noticeable player vote',
  summary: 'A vote to switch between Walt and Zeb shows as a big amber card with a heading, so nobody misses it.',
  defaultOn: false,
  scope: 'device',
  slots: { 'vote-heading': Heading, 'vote-status': Status },
};
