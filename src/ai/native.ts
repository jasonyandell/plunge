/** Mac research transport. Only an actor's own/public request crosses /decide. */
import { type GameState, type Seat, type Action, legalActions, toSeed } from '../engine';
import { observe } from './observation';
import { playRequestOf } from './walt/requests';

export const NATIVE_TABLE = import.meta.env.VITE_NATIVE_TABLE === '1';
export type NativeDifficulty = 'native-l1' | 'native-partner';
export function isNative(value: string): value is NativeDifficulty {
  return value === 'native-l1' || value === 'native-partner';
}
export const nativeLabel = (d: NativeDifficulty): string => d === 'native-l1' ? 'L1' : 'L1 + partner check';

export interface NativeRequest {
  decl: number; bid: number; bidder: number; seat: number; hand: number[]; plays: number[]; seed: number;
}
export interface NativeReceipt {
  schema: 'plunge-decision-v1'; id: string; created: string;
  identity: { request: NativeRequest; player: { name: string }; implementation: unknown; game_id: string; hand_number: number };
  response: {
    choice: number; legal: number[]; route: string; leader: number; points: number[]; elapsed_us: number;
    review_result?: { status: string; baseline: number; choice: number; samples?: number; support?: number;
      coverage?: string; values?: [number, number][]; paired?: number[][] } | null;
  };
}
export interface FlagRecord {
  id: string; ply: number; share_code: string; played: number; alternative: number | null; note: string;
  request: NativeRequest; receipt_id: string | null; original_receipt: NativeReceipt | null;
}
export interface Comparison {
  status: 'ready' | 'running' | 'partial' | 'outside-scope' | 'complete'; message?: string; saved?: number;
  support?: number; limit?: number; objective?: 'make' | 'set'; meaning?: string;
  actions?: { tile: number; makes: number; worlds: number; best: boolean; played: boolean; alternative: boolean }[];
}

export function nativeSeed(gameId: string, handNumber: number): number {
  return toSeed(`sunshine/${gameId}/${handNumber}`);
}
export function requestOf(g: GameState, seat: Seat, gameId: string): NativeRequest {
  const req = playRequestOf(observe(g, seat), { n: 40, n0: 8 });
  if (!req || req.bid !== 30) throw new Error('The Mac player needs straight 42 with a 30 bid.');
  return { decl: req.decl, bid: req.bid, bidder: req.bidder, seat: req.seat,
    hand: [...req.hand], plays: [...req.plays], seed: nativeSeed(gameId, g.handNumber) };
}
export function requestKey(req: NativeRequest): string {
  return JSON.stringify([req.decl, req.bid, req.bidder, req.seat, req.hand, req.plays, req.seed]);
}

export async function api<T>(path: string, body?: unknown, milliseconds = 18000): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    cache: 'no-store',
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    signal: AbortSignal.timeout(milliseconds),
  });
  let value;
  try { value = await response.json() as { error?: string }; }
  catch { throw new Error('The Mac player is unavailable. Start the local table launcher and retry.'); }
  if (!response.ok || value.error) throw new Error(value.error ?? `Request failed (${response.status})`);
  return value as T;
}

export function checkedAction(g: GameState, request: NativeRequest, receipt: NativeReceipt): Action {
  if (receipt.schema !== 'plunge-decision-v1' || requestKey(receipt.identity.request) !== requestKey(request)) {
    throw new Error('The decision receipt does not match this position.');
  }
  const r = receipt.response;
  if (r.leader !== g.leader || JSON.stringify(r.points) !== JSON.stringify(g.points)) {
    throw new Error('The native player and table disagree about this position.');
  }
  const id = requestTile(r.choice);
  const action = legalActions(g).find((a) => a.type === 'play' && a.domino === id);
  if (!action) throw new Error('The native player returned an illegal move.');
  return action;
}

export function requestTile(tile: number): string {
  if (!Number.isInteger(tile) || tile < 0 || tile > 27) throw new Error('Invalid native domino.');
  let hi = 0;
  while ((hi + 1) * (hi + 2) / 2 <= tile) hi++;
  return `${hi}${tile - hi * (hi + 1) / 2}`;
}

export async function nativeMove(g: GameState, seat: Seat, difficulty: NativeDifficulty, gameId: string): Promise<NativeReceipt> {
  const request = requestOf(g, seat, gameId);
  const player = difficulty === 'native-l1' ? 'l1-default' : 'l1-partner-rollout';
  const receipt = await api<NativeReceipt>('decide', { request, player, game_id: gameId, hand_number: g.handNumber });
  if (receipt.identity.player.name !== player || receipt.identity.game_id !== gameId || receipt.identity.hand_number !== g.handNumber) {
    throw new Error('The native player returned a receipt for a different game.');
  }
  checkedAction(g, request, receipt);
  return receipt;
}
