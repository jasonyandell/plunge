import type { Action, GameState, Seat } from '../engine';
import type { AuctionEvidence } from '../ai/auction';
import type { HandRetry } from '../ui/store';

export interface RoomCredentials { roomId: string; token: string; seat: Seat }
export interface RoomSeat { name: string; connected: boolean }
/** Trusted family prototype: all four hands are shared with room members. */
export interface RoomState {
  type: 'state'; roomId: string; revision: number; seed: string; sessionId: string;
  game: GameState | null; seats: (RoomSeat | null)[]; hostConnected: boolean;
  started: boolean; holdUntil: number; thinkingSeat: Seat | null;
  nativeReceipts: Record<string, string>; auctionSurveys: Record<string, AuctionEvidence>;
  /** Optional on snapshots from an older coordinator. */
  canUndo?: boolean; retry?: HandRetry | null; practiceHands?: readonly number[];
  lastUndo?: { revision: number; seat: Seat; name: string } | null;
}
export interface RoomCommand {
  type: 'start' | 'action' | 'thinking' | 'undo'; id: string; revision: number;
  action?: Action; receiptId?: string; auction?: AuctionEvidence; seat?: Seat | null;
}
export interface RoomError { type: 'error'; id?: string; message: string }
export interface RoomAck { type: 'ack'; id: string; revision: number }
export type RoomMessage = RoomState | RoomError | RoomAck;
export const ROOM_ID = /^[a-f0-9]{32}$/;
