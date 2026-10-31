import type { AuctionSlotProps, ModManifest } from '../../kernel/mod-api';
import { BiddingHint } from './BiddingHint';

// No hooks here: tests call the sheets as plain functions.
const Hint = ({ game, showHints, player, bookSeat, sessionId, questionGameId, onQuestion }: AuctionSlotProps) => showHints
  ? <BiddingHint player={player} bookSeat={bookSeat} g={game} sessionId={sessionId} questionGameId={questionGameId} onQuestion={onQuestion} />
  : null;

export const biddingHint: ModManifest = {
  id: 'bidding-hint',
  title: 'Bidding hints',
  summary: 'With Show hints on, a Help me bid button on the bid and trump sheets asks the computer player what it would do.',
  defaultOn: true,
  scope: 'device',
  slots: { 'bid-sheet': Hint, 'declare-sheet': Hint },
};
