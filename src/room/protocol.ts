import type { NativeReceipt } from '../ai/native';
import type { PlayerId, PlayerEvent, PlayerIdentity } from '../ai/players';
import type { Action, GameState, Seat } from '../engine';
import type { AuctionEvidence } from '../ai/auction';
import type { HandRetry } from '../ui/store';

export interface RoomCredentials { roomId: string; token: string; seat: Seat }
/** `away`: absent long enough that Walt plays this seat until the person returns. */
export interface RoomSeat { name: string; connected: boolean; away: boolean }
export interface RoomHand {
  sessionId: string;
  game: GameState;
  names: string[];
  practice: boolean;
  /** Recorded decision identities only; absent when the original version was not recorded. */
  models?: readonly PlayerIdentity[];
}
/** Bound the room's saved snapshots and reconnect payload. */
export const ROOM_HISTORY_LIMIT = 20;
/** A table on the home screen's list: who is here now, and whether the door is open. */
export interface ListedTable { rejoin?: boolean; roomId: string; standing: boolean; player?: PlayerId; open: boolean; started: boolean; updated: number; seats: ({ name: string; connected: boolean } | null)[] }

/** Everything the table decides together goes through one proposal at a time. A knock is not one of them. */
export type ProposalKind = 'start' | 'restart' | 'next-hand' | 'undo' | 'open' | 'close' | 'kick' | 'player';
export type Vote = 'yes' | 'no';
/** veto: passes at the deadline unless someone says no. allow: fails at the deadline unless enough say yes. */
export type ProposalMode = 'veto' | 'allow';
export interface Proposal {
  id: string; kind: ProposalKind; mode: ProposalMode; needs: 'all' | 'two' | 'majority';
  by: Seat; byName: string;
  /** Seat a kick would empty. */
  target?: Seat;
  player?: PlayerId;
  /** The coordinator's consequence, shown beside every vote. */
  endsGame?: boolean;
  /** Model changes and next-hand readiness keep the people who were asked: disconnecting is not agreement. */
  electorate?: Seat[];
  at: number; deadline: number;
  votes: Partial<Record<Seat, Vote>>;
}
export type ProposalOutcome = 'passed' | 'failed' | 'moot';
export interface VoteResult {
  revision: number; kind: ProposalKind; byName: string; outcome: ProposalOutcome;
  /** Who said no, when that decided it. */
  noFrom?: string; targetName?: string; player?: PlayerId; endsGame?: boolean;
}
/** Someone at the door of a closed table. Not a vote: the first person at the table to
 * answer decides, whatever else the table is doing. Gone when they stop waiting. */
export interface Knock { visitor: string; name: string; at: number; answer?: { by: string; yes: boolean; at: number } }

/** Trusted family prototype: all four hands are shared with room members. */
export interface RoomState {
  type: 'state'; roomId: string; revision: number; seed: string; sessionId: string;
  player?: PlayerId; modelKey?: string; playerEvents?: readonly PlayerEvent[];
  game: GameState | null; seats: (RoomSeat | null)[];
  /** Lowest seated, connected human: runs Walt for every seat without a present human. */
  runner: Seat | null;
  /** Open tables seat anyone with the link; closed tables ask the people present. */
  open: boolean; visitors: number;
  proposal: Proposal | null; lastVote: VoteResult | null;
  /** Optional on snapshots from an older coordinator. */
  knocks?: Knock[];
  started: boolean; holdUntil: number; thinkingSeat: Seat | null;
  decisionReceipts?: Record<string, NativeReceipt>;
  nativeReceipts: Record<string, string>; auctionSurveys: Record<string, AuctionEvidence>;
  /** Optional on snapshots from an older coordinator. */
  canUndo?: boolean; retry?: HandRetry | null; practiceHands?: readonly number[];
  /** Completed hands before the current deal, oldest first; absent in older rooms. */
  recentHands?: readonly RoomHand[];
  lastUndo?: { revision: number; seat: Seat; name: string } | null;
}
/** `revision` guards game-changing commands. A vote is keyed to its proposal instead. */
export type RoomCommand =
  | { type: 'action'; id: string; revision: number; action: Action; receiptId?: string; receipt?: NativeReceipt; auction?: AuctionEvidence; seat?: Seat; modelKey?: string }
  | { type: 'thinking'; id: string; revision: number; seat: Seat | null }
  | { type: 'propose'; id: string; revision: number; kind: ProposalKind; target?: Seat; player?: PlayerId; endGame?: boolean }
  | { type: 'vote'; id: string; proposal: string; vote: Vote; endGame?: boolean }
  | { type: 'leave'; id: string }
  | { type: 'knock'; id: string; name: string }
  | { type: 'door'; id: string; visitor: string; yes: boolean };
export interface RoomError { type: 'error'; id?: string; message: string }
export interface RoomAck { type: 'ack'; id: string; revision: number }
export type RoomMessage = RoomState | RoomError | RoomAck;
export const ROOM_ID = /^[a-f0-9]{32}$/;
export const VISITOR_ID = /^[a-f0-9]{16}$/;
/** Socket close codes the client reads. */
export const CLOSE_OTHER_TAB = 4001, CLOSE_PAUSED = 4002, CLOSE_SEAT_GONE = 4003, CLOSE_EXPIRED = 4000;
