/** Everything a mod may import besides preact, src/engine and its own folder.
 * tests/mod-boundary.test.ts holds mods to that. */
import type { ComponentType } from 'preact';
import type { DominoId, GameState, Seat } from '../engine';
import type { Proposal, Vote } from '../room/protocol';

export { store, type ModStore } from './store';
export { Domino, dominoAriaLabel } from '../ui/Domino';
export { PIP_SUIT_NAMES, bidLabel, contractLabel, declLabel, ledChip, trumpChip } from '../ui/wording';
export { BookDetails, ForecastDetails, waltAuctionAdvice, zebAuctionAdvice, type WaltAuctionAdvice, type ZebAuctionAdvice } from './advice';
export type { Proposal, Vote };

/** Read-only view of the table, from the viewer's chair. */
export interface TableSlotProps {
  game: GameState;
  /** The viewer's seat in `game` (the table always seats the viewer at the bottom). */
  seat: Seat;
}

/** What else is on screen, so decor can hold still or step aside. */
export interface TableUi {
  menuOpen: boolean;
  /** The trick history under the info bar. */
  historyOpen: boolean;
  /** A bid or trump sheet, an end-of-hand card, a question prompt or the replay check. */
  sheetOpen: boolean;
  /** The finished trick is held on the felt before it is gathered. */
  showingLast: boolean;
  /** Reviewing a finished hand trick by trick. */
  review: boolean;
  /** A shared hand from a link, view-only. */
  scenario: boolean;
  /** A shared table is voting on something. */
  proposal: boolean;
}

export interface DecorSlotProps extends TableSlotProps { ui: TableUi }

export type SeatRelation = 'you' | 'partner' | 'opponent';
export interface SeatSlotProps {
  game: GameState;
  /** The viewer's seat in `game`. */
  viewer: Seat;
  /** The seat this is about. */
  seat: Seat;
  name: string;
  relation: SeatRelation;
}

export interface HandSlotProps extends TableSlotProps {
  /** The viewer's dominoes, in the order core would show them. */
  hand: readonly DominoId[];
  /** Playable now. Empty unless it is the viewer's turn to play. */
  legal: ReadonlySet<DominoId>;
  humanTurn: boolean;
  /** The Show hints setting: core marks legal and illegal tiles when it is on. */
  showHints: boolean;
  /** Plays the domino, or explains why it can't be played. */
  onPlay: (id: DominoId) => void;
}

/** Bid and trump sheets, for advice about the viewer's auction turn. */
export interface AuctionSlotProps extends TableSlotProps {
  /** Which computer player's advice the table uses. */
  player: 'walt' | 'zeb';
  /** The viewer's seat at a shared table (unrotated), for the bidding book; 0 when solo. */
  bookSeat: Seat;
  showHints: boolean;
  sessionId: string;
  questionGameId: string;
  /** Opens a saved question. */
  onQuestion: (id: string) => void;
}

export interface VoteSlotProps {
  proposal: Proposal;
  /** The viewer's seat, or null when watching. */
  seat: Seat | null;
  mine: Vote | undefined;
  yes: number;
  /** Yes votes still needed. */
  more: number;
}

export interface GameOverSlotProps extends TableSlotProps { won: boolean }

/** Components, each rendered where its name says. */
export interface SlotProps {
  /** Just above your hand, at the bottom of the felt. */
  'table-above-hand': TableSlotProps;
  /** Over the felt (`position: relative`); place yourself and don't block taps. */
  'table-decor': DecorSlotProps;
  /** After a seat's name. */
  'seat-label': SeatSlotProps;
  /** Replaces your hand while you play. One mod at a time: see REPLACING_SLOTS. */
  'hand': HandSlotProps;
  'bid-sheet': AuctionSlotProps;
  'declare-sheet': AuctionSlotProps;
  /** Above a shared table's vote text. */
  'vote-heading': VoteSlotProps;
  /** After your vote or the vote buttons. */
  'vote-status': VoteSlotProps;
  /** Top of the game-over card. */
  'gameover-header': GameOverSlotProps;
}

/** Plain functions core asks while it renders. */
export interface SlotFns {
  /** True to show `seat`'s hand face up. Only asked off shared tables and only for others' seats;
   * any mod saying true reveals it. */
  'seat-reveal': (p: SeatSlotProps) => boolean;
  /** Words under a sitting-out hand in place of core's; the first mod with words wins. */
  'seat-note': (p: SeatSlotProps) => string | null;
}

export type SlotName = keyof SlotProps;
export type FnSlotName = keyof SlotFns;
/** Only one enabled mod fills these: the first in src/mods/index.ts. */
export const REPLACING_SLOTS = ['hand'] as const satisfies readonly SlotName[];
export type ModSlots = { [N in SlotName]?: ComponentType<SlotProps[N]> } & { [N in FnSlotName]?: SlotFns[N] };

export interface ModManifest {
  id: string;
  title: string;
  summary: string;
  defaultOn: boolean;
  scope: 'device';
  slots: ModSlots;
}
