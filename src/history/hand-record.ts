/**
 * The finished-hand record as it travels: validated identically on the device
 * and in the worker, so a record the device wrote is a record the account keeps.
 */
import { decodeReplay } from '../engine/replay-code';
import type { GameState } from '../engine';
import type { HandRecord } from './legacy';

export const GAME_ID = /^[a-zA-Z0-9_-]{1,80}$/;
export const DEVICE_ID = /^[a-f0-9]{32}$/;
/** Hands per upload; a device with a long log connects over several requests. */
export const UPLOAD_BATCH = 100;
export const MAX_UPLOAD_BYTES = 512_000;
const MARK = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 99;
const marks = (v: unknown): v is readonly [number, number] => Array.isArray(v) && v.length === 2 && v.every(MARK);

/** The record with only its known fields and its decoded hand, or an Error naming what is wrong. */
export function validHandRecord(value: unknown): { record: HandRecord; game: GameState } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Not a hand record.');
  const r = value as Record<string, unknown>;
  if (r.schema !== 'plunge-hand-v1') throw new Error('Unknown hand record schema.');
  if (typeof r.gameId !== 'string' || !GAME_ID.test(r.gameId)) throw new Error('Invalid game id.');
  if (!Number.isSafeInteger(r.handNumber) || (r.handNumber as number) < 1 || (r.handNumber as number) > 99999) throw new Error('Invalid hand number.');
  if (r.id !== `${r.gameId}:${r.handNumber}`) throw new Error('Hand id does not match its game and hand number.');
  if (typeof r.code !== 'string' || r.code.length > 512) throw new Error('Invalid replay.');
  const game = decodeReplay(r.code);
  if (!game || (game.phase !== 'hand-over' && game.phase !== 'game-over')) throw new Error('The replay is not a finished hand.');
  if (typeof r.endedAt !== 'string' || r.endedAt.length > 40 || Number.isNaN(Date.parse(r.endedAt))) throw new Error('Invalid end time.');
  if (!marks(r.marksBefore) || !marks(r.marksAfter)) throw new Error('Invalid marks.');
  if (typeof r.gameOver !== 'boolean' || typeof r.thrownIn !== 'boolean') throw new Error('Invalid result flags.');
  if (r.thrownIn !== game.thrownIn) throw new Error('The replay disagrees about the thrown-in hand.');
  if (typeof r.player !== 'string' || !r.player || r.player.length > 40) throw new Error('Invalid computer player.');
  if (r.practiceHands !== undefined && (!Array.isArray(r.practiceHands) || r.practiceHands.length > 1000
    || !r.practiceHands.every((n) => Number.isSafeInteger(n) && (n as number) >= 1))) throw new Error('Invalid practice hands.');
  return { game, record: {
    schema: 'plunge-hand-v1', id: r.id, gameId: r.gameId, handNumber: r.handNumber as number, code: r.code, endedAt: r.endedAt,
    marksBefore: [r.marksBefore[0], r.marksBefore[1]], marksAfter: [r.marksAfter[0], r.marksAfter[1]],
    gameOver: r.gameOver, thrownIn: r.thrownIn, player: r.player,
    ...(r.practiceHands !== undefined && (r.practiceHands as number[]).length ? { practiceHands: [...(r.practiceHands as number[])] } : {}),
  } };
}

/**
 * The plain facts of a finished hand for leaderboards and same-deal play,
 * read from the replay rather than trusted from the device. A seat's team is
 * seat % 2, so whether a player won is resultTeam === seat % 2.
 */
export interface HandSummary {
  /** Shaker plus the four dealt hands: everyone who played this exact deal shares it. */
  readonly deal: string;
  readonly bidder: number | null;
  /** Points bids as bid; mark bids as 42 per mark. */
  readonly bid: number | null;
  readonly contract: string | null;
  readonly declaration: string | null;
  readonly resultTeam: number | null;
  readonly resultMarks: number | null;
  readonly points: readonly [number, number];
  readonly tricks: readonly [number, number];
}
export function handSummary(record: HandRecord, game: GameState): HandSummary {
  const result = game.handResult, contract = result?.contract ?? game.contract;
  const declaration = game.declaration;
  return {
    deal: record.code.slice(3, 60),
    bidder: result?.declarer ?? game.declarer,
    bid: contract ? (contract.kind === 'points' ? contract.value : 42 * contract.value) : null,
    contract: contract?.kind ?? null,
    declaration: declaration ? (declaration.type === 'pip' ? String(declaration.pip) : declaration.type) : null,
    resultTeam: result?.team ?? null,
    resultMarks: result?.marks ?? null,
    points: [game.points[0], game.points[1]],
    tricks: [game.tricks.filter((t) => t.winner % 2 === 0).length, game.tricks.filter((t) => t.winner % 2 === 1).length],
  };
}
