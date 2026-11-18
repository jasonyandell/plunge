/** Character identity is separate from the versioned implementation. Safe in Workers too. */
import zebPackage from '@jasonyandell/zeb/package.json';
import walt from './phone/manifest.json';
import type { GameState, Seat } from '../engine';

export const PLAYERS = {
  'native-partner': { character: 'walt', name: 'Walt', version: walt.player, implementation: walt.wasm_sha256,
    receiptName: 'l1-partner-rollout', package: 'bundled:walt', capabilities: { bidding: 'recorded-hands', nello: true },
    description: 'Plays prepared hands with bids supplied by recorded games. Studies each move with a partner check.' },
  'native-l1': { character: 'walt', name: 'Walt L1', version: walt.player, implementation: walt.wasm_sha256,
    receiptName: 'l1-default', package: 'bundled:walt', capabilities: { bidding: 'recorded-hands', nello: true },
    description: 'Plays prepared hands with bids supplied by recorded games. The original Walt analysis, without the partner check.' },
  zeb: { character: 'zeb', name: 'Zeb', version: zebPackage.version, implementation: `@jasonyandell/zeb@${zebPackage.version}`,
    receiptName: `zeb-${zebPackage.version}`, package: zebPackage.name, capabilities: { bidding: 'forecast', nello: false },
    description: 'Forecasts bids from your hand and reads public play. Every new hand is freshly shuffled.' },
} as const;
export type PlayerId = keyof typeof PLAYERS;
export const DEFAULT_PLAYER: PlayerId = 'native-partner';
export const SELECTABLE_PLAYERS: readonly PlayerId[] = ['native-partner', 'zeb'];
export const isPlayer = (value: unknown): value is PlayerId => typeof value === 'string' && Object.hasOwn(PLAYERS, value);
export const playerId = (value: unknown): PlayerId => isPlayer(value) ? value : DEFAULT_PLAYER;
export const player = (value: unknown) => PLAYERS[playerId(value)];
/** Prepared bidding evidence and forecasting imply different supported deal sources. */
export const usesPreparedDeals = (value: unknown): boolean => player(value).capabilities.bidding === 'recorded-hands';
export const usesForecastBidding = (value: unknown): boolean => player(value).capabilities.bidding === 'forecast';
export function effectivePlayer(value: unknown, game?: Pick<GameState, 'contract'> | null): PlayerId {
  const id = playerId(value);
  return game?.contract?.kind === 'nello' && !PLAYERS[id].capabilities.nello ? DEFAULT_PLAYER : id;
}
export const playerLabel = (value: unknown, game?: Pick<GameState, 'contract'> | null): string => player(effectivePlayer(value, game)).name;
export const playerVersion = (value: unknown): string => `${player(value).name} · ${player(value).version}`;
export interface PlayerIdentity { id: PlayerId; character: string; name: string; version: string; implementation: string; package: string }
export function playerIdentity(value: unknown): PlayerIdentity {
  const id = playerId(value), p = player(id);
  return { id, character: p.character, name: p.name, version: p.version, implementation: p.implementation, package: p.package };
}
/** Wire token includes policy and artifact version, preventing an old runner from impersonating a new model. */
export const playerKey = (value: unknown): string => { const p = playerIdentity(value); return `${p.id}@${p.version}:${p.implementation}`; };
export interface PlayerEvent { handNumber: number; step: number; seat: Seat; phase: string; model: PlayerIdentity }
export function playerEvent(game: GameState, value: unknown): PlayerEvent {
  return { handNumber: game.handNumber, step: game.bids.length + (game.declaration ? 1 : 0)
    + game.tricks.reduce((n, t) => n + t.plays.length, 0) + game.currentTrick.length,
    seat: game.turn!, phase: game.phase, model: playerIdentity(effectivePlayer(value, game)) };
}
export function handPlayers(events: readonly PlayerEvent[] | undefined, handNumber: number): PlayerIdentity[] {
  return [...new Map((events ?? []).filter(e => e.handNumber === handNumber).map(e =>
    [`${e.model.id}@${e.model.version}:${e.model.implementation}`, e.model])).values()];
}
/** Never assign today's version to an old log with no recorded model identity. */
export function recordedPlayerLabel(value: string): string {
  if (value === 'room') return 'Family table · model not recorded';
  if (value === 'mixed') return 'Multiple models';
  return isPlayer(value) ? `${player(value).name} · version not recorded` : value;
}

export function validPlayerIdentity(value: unknown): value is PlayerIdentity {
  if (!value || typeof value !== 'object') return false;
  const p = value as PlayerIdentity;
  return ['id', 'character', 'name', 'version', 'implementation', 'package'].every(key => {
    const v = p[key as keyof PlayerIdentity]; return typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f]/.test(v);
  });
}
export function validPlayerEvents(value: unknown): value is PlayerEvent[] {
  return Array.isArray(value) && value.length <= 10000 && value.every(e => e && Number.isSafeInteger(e.handNumber) && e.handNumber > 0
    && Number.isSafeInteger(e.step) && e.step >= 0 && e.step <= 40 && [0,1,2,3].includes(e.seat)
    && ['bidding','declaring','playing'].includes(e.phase) && validPlayerIdentity(e.model));
}
