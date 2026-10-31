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
  category: 'help',
  details: 'Help me bid shows what the computer player would do with your hand: Walt’s bid or trump with the bidding book behind it, or Zeb’s forecast. It shows only while Show hints is on. Built into Plunge, so it starts on.',
  defaultOn: true,
  scope: 'device',
  slots: { 'bid-sheet': Hint, 'declare-sheet': Hint },
};
