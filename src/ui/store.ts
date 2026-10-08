/**
 * UI store: a small pure reducer that orchestrates the engine.
 *
 * ALL game logic lives in src/engine — this file only:
 *   - routes screens and settings,
 *   - applies human actions via applyAction,
 *   - steps one AI action per 'ai' event (scheduling/timers live in App.tsx,
 *     so everything here is testable without timers),
 *   - pauses briefly after a completed trick so the table can show it.
 */

import type { Difficulty } from '../ai';
import { chooseAction } from '../ai/table';
import { catalogueDeal } from '../ai/catalogue';
import { NATIVE_TABLE, isNative, requestOf, requestKey, checkedAction, type NativeReceipt, type FlagRecord } from '../ai/native';
import { auctionKey, type AuctionDecision, type AuctionEvidence } from '../ai/auction';
import {
  type Action,
  type Bid,
  type Contract,
  type Declaration,
  type GameConfig,
  type GameState,
  type HandResult,
  type Phase,
  type PlayRecord,
  type Seat,
  type Team,
  CALLED_SUIT,
  CASUAL_CONFIG,
  TOURNAMENT_CONFIG,
  PLUNGE_CONFIG,
  LEGACY_PLUNGE_CONFIG,
  applyAction,
  fromId,
  ledSuitOf,
  mulberry32,
  newGame,
  teamOf,
} from '../engine';
import { encodeReplay } from '../engine/replay-code';
import { handStartOf, handSteps, type HandStep } from '../engine/hand-history';
import type { RoomState } from '../room/protocol';
import { rotateGame } from '../room/view';
export { handStartOf, handSteps, type HandStep } from '../engine/hand-history';

export const HUMAN_SEAT = 0 as Seat;

/** Seat 0 = you (bottom). Clockwise: 1 = left, 2 = across, 3 = right. */
export const SOLO_SEAT_NAMES: readonly [string, string, string, string] = ['You', 'Earl', 'Gran', 'Ruby'];
/**
 * Who sits where, as the table shows it. Solo play is always Earl, Gran and
 * Ruby. A shared table sets the family's names (rotated so you are seat 0)
 * for as long as it is open; every screen reads this live binding.
 */
export let SEAT_NAMES: readonly [string, string, string, string] = SOLO_SEAT_NAMES;
export function setSeatNames(names: readonly [string, string, string, string] | null): void {
  SEAT_NAMES = names ?? SOLO_SEAT_NAMES;
}

export type Preset = 'casual' | 'tournament';

export interface Settings {
  readonly difficulty: Difficulty;
  readonly preset: Preset;
  readonly thinkDeeper: boolean;
  readonly nelloPreview: boolean;
  readonly showHints: boolean;
}

export const DEFAULT_SETTINGS: Settings = { difficulty: 'native-partner', preset: 'tournament', thinkDeeper: false, nelloPreview: false, showHints: true };

/** Rotate the bidder with the shaker; use real engine auction transitions. */
export function practice30(game: GameState): GameState {
  if (game.phase !== 'bidding' || game.bids.length) return game;
  game = applyAction(game, { type: 'bid', bid: { kind: 'points', value: 30 } });
  for (let i = 0; i < 3; i++) game = applyAction(game, { type: 'bid', bid: { kind: 'pass' } });
  return game;
}

export function configFor(preset: Preset): GameConfig {
  return preset === 'tournament' ? TOURNAMENT_CONFIG : CASUAL_CONFIG;
}

/** The preview requires the browser player, which includes counterexample defense. */
export function nelloAvailable(settings: Settings): boolean {
  return settings.nelloPreview && isNative(settings.difficulty) && !NATIVE_TABLE;
}

function tableConfig(settings: Settings): GameConfig {
  if (isNative(settings.difficulty)) return nelloAvailable(settings) ? PLUNGE_CONFIG : LEGACY_PLUNGE_CONFIG;
  return { ...configFor(settings.preset), nello: 'off' };
}

/** Apply availability before declaration; never rewrite a contract already in play. */
function configureAuction(game: GameState | null, settings: Settings): GameState | null {
  return game && (game.phase === 'bidding' || game.phase === 'declaring')
    ? { ...game, config: tableConfig(settings) } : game;
}

export function nelloPaused(s: AppState): boolean {
  return s.game?.phase === 'playing' && s.game.contract?.kind === 'nello' && !nelloAvailable(s.settings);
}

export type Screen = 'home' | 'table' | 'how' | 'about' | 'more';

export interface SharedRoom {
  readonly mode: 'shared-room'; readonly localSeat: Seat; readonly revision: number;
  readonly humans: readonly { seat: Seat; name: string }[];
  /** The table as the coordinator last sent it, in canonical seats. Live only; never recorded. */
  readonly table?: RoomState;
}
export interface AppState {
  /**
   * Set while this app shows a shared family table. `game` is then the
   * coordinator's game rotated so you are seat 0; moves go to the room, not
   * the reducer, and the solo save underneath stays untouched.
   */
  readonly room?: SharedRoom;
  readonly screen: Screen;
  readonly settings: Settings;
  readonly seed: string;
  readonly game: GameState | null;
  /** Count of AI actions taken this game — seeds the AI's deterministic rand. */
  readonly aiMoves: number;
  /** True while the just-completed trick is being shown before play resumes. */
  readonly showTrick: boolean;
  /**
   * A shared hand opened from a link — view-only review. Displayed instead
   * of `game` on the table, never persisted, never steps the AI, and the
   * player's own in-progress game stays untouched underneath.
   */
  readonly scenarioGame: GameState | null;
  readonly sessionId: string;
  readonly nativeReceipts: Record<string, string>;
  readonly scenarioFlag: FlagRecord | null;
  readonly auctionSurveys: Record<string, AuctionEvidence>;
  /**
   * Table generation. Undo, restart and new games advance it; computer
   * responses and the trick pause carry the generation they were started in,
   * so work begun before a rollback never lands afterward — even when the
   * restored position (and therefore every request key) is identical.
   */
  readonly epoch: number;
  /** Retry provenance for the current hand; null for an ordinary first attempt. */
  readonly retry: HandRetry | null;
  /** Hands of this game that were undone or restarted (practice, not fresh results). */
  readonly practiceHands: readonly number[];
}

/** The branch abandoned by an undo or restart, captured before rollback. */
export interface AbandonedBranch {
  readonly code: string | null;
  readonly phase: Phase;
  readonly marks: readonly [number, number];
  readonly handResult: HandResult | null;
  readonly winner: Team | null;
  readonly thrownIn: boolean;
}

export interface HandRetry {
  readonly handNumber: number;
  /** 1 for the first undo/restart of this hand, then 2, 3, … */
  readonly attempt: number;
  readonly kind: 'undo' | 'restart';
  /** Hand actions (bids, trump call, plays) kept from the deal. 0 = restart. */
  readonly kept: number;
  readonly from: AbandonedBranch;
  /** True once any attempt of this hand reached its result. */
  readonly sawResult: boolean;
}

export type ChooseFn = typeof chooseAction;

export type AppEvent =
  | { readonly type: 'go'; readonly screen: Screen }
  | { readonly type: 'set-difficulty'; readonly difficulty: Difficulty }
  | { readonly type: 'set-preset'; readonly preset: Preset }
  | { readonly type: 'set-think-deeper'; readonly enabled: boolean }
  | { readonly type: 'set-nello-preview'; readonly enabled: boolean }
  | { readonly type: 'set-show-hints'; readonly enabled: boolean }
  | { readonly type: 'new-game'; readonly seed: string; readonly sessionId?: string }
  | { readonly type: 'resume' }
  /** `epoch` is stamped by the live table (see liveDispatch); tests may omit it. */
  | { readonly type: 'human'; readonly action: Action; readonly epoch?: number }
  /** Step exactly one AI action (if one is pending). `choose` is injectable for tests. */
  | { readonly type: 'ai'; readonly choose?: ChooseFn | undefined; readonly epoch?: number }
  | { readonly type: 'trick-shown'; readonly epoch?: number }
  /** Open a shared hand (from a share link) in view-only review. */
  | { readonly type: 'view-scenario'; readonly game: GameState; readonly flag?: FlagRecord }
  | { readonly type: 'native-ai'; readonly receipt: NativeReceipt; readonly epoch?: number }
  | { readonly type: 'auction-ai'; readonly decision: AuctionDecision; readonly epoch?: number }
  /**
   * Roll back to just before your most recent decision this hand. `epoch` is
   * the generation the button was rendered in: a duplicate of the same tap is
   * stale after the first one lands, so it can't step a second checkpoint.
   */
  | { readonly type: 'undo'; readonly epoch: number }
  /** Replay this exact deal from the start, with the marks it began with. */
  | { readonly type: 'restart-hand'; readonly epoch: number }
  /** Sit at a shared table: the game arrives with the first snapshot. */
  | { readonly type: 'room-enter'; readonly localSeat: Seat }
  /** The coordinator's latest view of a shared table. */
  | { readonly type: 'room-snapshot'; readonly state: RoomState; readonly localSeat: Seat; readonly now?: number }
  /** Stand up from a shared table; the solo game is reloaded by the page. */
  | { readonly type: 'room-exit' };

/**
 * The table's dispatch: every human decision carries the generation it was
 * rendered in, so a callback captured before an undo or replay is rejected.
 */
export function liveDispatch(dispatch: (e: AppEvent) => void, epoch: number): (e: AppEvent) => void {
  return (e) => dispatch(e.type === 'human' ? { ...e, epoch } : e);
}

/** A computer/timer event from an older generation is dropped. Tests may omit it. */
function stale(s: AppState, epoch: number | undefined): boolean {
  return epoch !== undefined && epoch !== s.epoch;
}

export function initialApp(saved?: SavedState | null, search = ''): AppState {
  if (saved && !isNative(saved.settings.difficulty)) saved = null;
  const experiment = new URLSearchParams(search).get('nello');
  const settings = { ...DEFAULT_SETTINGS, ...saved?.settings,
    ...(experiment === 'preview' || experiment === 'counterexamples' ? { nelloPreview: true }
      : experiment === 'off' || experiment === 'ordinary' ? { nelloPreview: false } : {}) };
  const game = configureAuction(saved?.game ?? null, settings);
  return {
    screen: 'home',
    settings,
    seed: saved?.seed ?? 'plunge',
    game,
    aiMoves: saved?.aiMoves ?? 0,
    showTrick: saved?.showTrick ?? false,
    scenarioGame: null,
    scenarioFlag: null,
    sessionId: saved?.sessionId ?? 'legacy',
    nativeReceipts: saved?.nativeReceipts ?? {},
    auctionSurveys: saved?.auctionSurveys ?? {},
    epoch: saved?.epoch ?? 0,
    retry: saved?.retry && game && saved.retry.handNumber === game.handNumber ? saved.retry : null,
    practiceHands: saved?.practiceHands ?? [],
  };
}

// ---------------------------------------------------------------------------
// Undo and replaying a hand. Checkpoints are derived from the hand itself —
// the deal plus its ordered bids, trump call and plays — so old saves gain
// them for free and nothing extra needs to be persisted to stay consistent.
// ---------------------------------------------------------------------------

function retryable(s: AppState): GameState | null {
  return s.game && !s.scenarioGame && !nelloPaused(s) && !s.room ? s.game : null;
}

/**
 * Is there a decision of yours this hand to take back? Exactly when the
 * reducer would act on an Undo — the button is never offered as a no-op.
 * At a shared table the coordinator decides, and the table votes on it.
 */
export function canUndo(s: AppState): boolean {
  if (s.room) return !s.scenarioGame && s.room.table?.canUndo === true;
  return rollbackTarget(s, 'undo') !== null;
}

/** Has anything happened this hand that replaying it would clear? (Never at a shared table.) */
export function canRestart(s: AppState): boolean {
  return rollbackTarget(s, 'restart') !== null;
}

/** Question bookmarks from a retried hand get their own branch id, so they never merge with the original's. */
export function questionGameId(s: Pick<AppState, 'sessionId' | 'retry' | 'game'>): string {
  return s.retry && s.game && s.retry.handNumber === s.game.handNumber
    ? `${s.sessionId.slice(0, 70)}-r${s.retry.attempt}` : s.sessionId;
}

/** Key-order-independent equality for plain engine state. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
}

/**
 * The state an undo or replay would produce, or null when there is none.
 *
 * Undo replays the kept decisions from the deal under the hand's current
 * rules. It is offered only when replaying *every* decision under those rules
 * reproduces the hand exactly, so a recorded bid or call is never reinterpreted.
 * Live toggles (Walt version, Nel-O preview) never fail this: the two Plunge
 * configs differ only in Nel-O availability, which bids don't depend on. A
 * legacy computer-player switch between reshake and forced-30 rules mid-auction
 * can; then only "Play this hand again" — a fresh deal-start — is offered.
 */
function rollbackTarget(s: AppState, kind: HandRetry['kind']): AppState | null {
  const g = retryable(s);
  if (!g) return null;
  let steps: HandStep[];
  try { steps = handSteps(g); } catch { return null; }
  let kept = 0;
  if (kind === 'undo') {
    kept = steps.map((step) => step.seat).lastIndexOf(HUMAN_SEAT);
    if (kept < 0) return null;
    try {
      const replayed = steps.reduce((at, step) => applyAction(at, step.action), handStartOf(g));
      if (canonical(replayed) !== canonical(g)) return null;
    } catch { return null; }
  } else if (!steps.length) return null;
  let game: GameState;
  try {
    // Availability applies as at any auction; a contract already in play keeps its rules.
    game = configureAuction(steps.slice(0, kept).reduce((at, step) => applyAction(at, step.action), handStartOf(g)), s.settings)!;
  } catch { return null; }
  const plays = game.tricks.reduce((n, t) => n + t.plays.length, 0) + game.currentTrick.length;
  const hand = `${g.handNumber}:`;
  const previous = s.retry?.handNumber === g.handNumber ? s.retry : null;
  const finished = g.phase === 'hand-over' || g.phase === 'game-over';
  return {
    ...s,
    game,
    showTrick: false,
    aiMoves: s.aiMoves - steps.slice(kept).filter((step) => step.seat !== HUMAN_SEAT).length,
    epoch: s.epoch + 1,
    // Links to undone moves leave the live table; the snapshots taken while
    // they were current keep them, and the receipts themselves are untouched.
    nativeReceipts: Object.fromEntries(Object.entries(s.nativeReceipts)
      .filter(([k]) => !k.startsWith(hand) || Number(k.slice(hand.length)) < plays)),
    auctionSurveys: Object.fromEntries(Object.entries(s.auctionSurveys)
      .filter(([k]) => !k.startsWith(hand) || game.bids.some((b) => k === `${hand}${b.seat}`))),
    retry: {
      handNumber: g.handNumber,
      attempt: (previous?.attempt ?? 0) + 1,
      kind,
      kept,
      from: { code: encodeReplay(g), phase: g.phase, marks: g.marks, handResult: g.handResult, winner: g.winner, thrownIn: g.thrownIn },
      sawResult: (previous?.sawResult ?? false) || finished,
    },
    practiceHands: s.practiceHands.includes(g.handNumber) ? s.practiceHands : [...s.practiceHands, g.handNumber],
  };
}

/** Did `next` complete a trick, including one that ends the hand or match? */
export function trickJustCompleted(prev: GameState, next: GameState): boolean {
  return next.tricks.length > prev.tricks.length;
}

/**
 * The AI seat that should act next, or null. Null while the human is up,
 * while a finished trick is on display, off the table screen, and in
 * hand-over / game-over (advancing to the next hand is the human's tap).
 */
export function pendingAiSeat(s: AppState): Seat | null {
  const g = s.game;
  // At a shared table the person running Walt submits its moves to the room.
  if (!g || s.room || nelloPaused(s) || s.screen !== 'table' || s.showTrick || s.scenarioGame) return null;
  if (g.phase !== 'bidding' && g.phase !== 'declaring' && g.phase !== 'playing') return null;
  if (g.turn === null || g.turn === HUMAN_SEAT) return null;
  return g.turn;
}

/** Deterministic rand for the nth AI action of a game. */
export function aiRand(game: GameState, aiMoves: number): () => number {
  return mulberry32((game.rngState ^ Math.imul(aiMoves + 1, 0x9e3779b9)) >>> 0);
}

export function reducer(s: AppState, e: AppEvent): AppState {
  switch (e.type) {
    case 'room-enter':
      return { ...s, screen: 'table', game: null, scenarioGame: null, scenarioFlag: null, showTrick: false, retry: null,
        practiceHands: [], nativeReceipts: {}, auctionSurveys: {}, aiMoves: 0,
        room: { mode: 'shared-room', localSeat: e.localSeat, revision: -1, humans: [] } };
    case 'room-snapshot': {
      const t = e.state, game = t.game ? rotateGame(t.game, e.localSeat) : null;
      return { ...s, screen: 'table', game, scenarioGame: null, scenarioFlag: null, aiMoves: 0,
        // The table's rules decide what is playable, not this phone's preview setting.
        settings: t.game?.config.nello === 'open' && !s.settings.nelloPreview ? { ...s.settings, nelloPreview: true } : s.settings,
        seed: t.seed, sessionId: t.sessionId || 'room', nativeReceipts: t.nativeReceipts, auctionSurveys: t.auctionSurveys,
        epoch: t.revision, retry: t.retry ?? null, practiceHands: t.practiceHands ?? [],
        showTrick: t.holdUntil > (e.now ?? Date.now()),
        room: { mode: 'shared-room', localSeat: e.localSeat, revision: t.revision, table: t,
          humans: t.seats.flatMap((seat, i) => seat ? [{ seat: i as Seat, name: seat.name }] : []) } };
    }
    case 'room-exit': {
      const { room: _room, ...rest } = s;
      return { ...rest, game: null, screen: 'home' };
    }
    case 'go':
      // Leaving for home closes any shared-hand review.
      return { ...s, screen: e.screen, scenarioGame: e.screen === 'home' ? null : s.scenarioGame,
        scenarioFlag: e.screen === 'home' ? null : s.scenarioFlag };
    case 'set-difficulty': {
      const settings = { ...s.settings, difficulty: e.difficulty,
        preset: isNative(e.difficulty) ? 'tournament' as const : s.settings.preset };
      const next = { ...s, settings, game: configureAuction(s.game, settings) };
      return nelloPaused(next) ? { ...next, screen: 'home' } : next;
    }
    case 'set-preset': {
      const settings = { ...s.settings, preset: e.preset };
      return { ...s, settings, game: configureAuction(s.game, settings) };
    }
    case 'set-nello-preview': {
      const settings = { ...s.settings, nelloPreview: e.enabled };
      const next = { ...s, settings, game: configureAuction(s.game, settings) };
      return nelloPaused(next) ? { ...next, screen: 'home' } : next;
    }
    case 'set-think-deeper':
      return { ...s, settings: { ...s.settings, thinkDeeper: e.enabled } };
    case 'set-show-hints':
      return { ...s, settings: { ...s.settings, showHints: e.enabled } };
    case 'new-game':
      if (s.room) return s; // The table votes to start; the room routes this before the reducer.
      return {
        ...s,
        screen: 'table',
        seed: e.seed,
        aiMoves: 0,
        showTrick: false,
        scenarioGame: null,
        scenarioFlag: null,
        sessionId: e.sessionId ?? `seed-${e.seed.replace(/[^a-zA-Z0-9_-]/g, '').slice(0,60) || 'game'}`,
        nativeReceipts: {},
        auctionSurveys: {},
        epoch: s.epoch + 1,
        retry: null,
        practiceHands: [],
        game: isNative(s.settings.difficulty)
          ? catalogueDeal(newGame(tableConfig(s.settings),e.seed),e.seed)
          : newGame(tableConfig(s.settings),e.seed),
      };
    case 'resume':
      return s.game && !nelloPaused(s) ? { ...s, screen: 'table', scenarioGame: null, scenarioFlag: null } : s;
    case 'view-scenario':
      return { ...s, screen: 'table', scenarioGame: e.game, scenarioFlag: e.flag ?? null };
    case 'trick-shown':
      return stale(s, e.epoch) ? s : { ...s, showTrick: false };
    case 'undo':
      return e.epoch === s.epoch ? rollbackTarget(s, 'undo') ?? s : s;
    case 'restart-hand':
      return e.epoch === s.epoch ? rollbackTarget(s, 'restart') ?? s : s;
    case 'human': {
      if (s.room) return s; // Shared-table moves go to the coordinator; only its snapshots change the game.
      if (!s.game || s.scenarioGame || s.showTrick || nelloPaused(s)) return s; // no moves during review, the trick pause, or a disabled preview
      // A tap rendered before an undo or replay never lands afterward, even at an identical position.
      if (stale(s, e.epoch)) return s;
      // Only your own turn: a late tap must never act for a computer seat.
      if (e.action.type !== 'next-hand' && s.game.turn !== HUMAN_SEAT) return s;
      if (e.action.type === 'declare' && e.action.decl.type === 'nello' && !nelloAvailable(s.settings)) return s;
      let game: GameState;
      try {
        game = applyAction(s.game, e.action);
        if (e.action.type === 'next-hand') {
          game = { ...game, config: tableConfig(s.settings) };
          if (isNative(s.settings.difficulty)) game = catalogueDeal(game,s.seed);
        }
      } catch {
        return s; // defensive: stale tap / double tap — ignore
      }
      if (e.action.type === 'next-hand') {
        // Earlier hands can't be undone once the next one is dealt.
        return { ...s, game, showTrick: false, auctionSurveys: {}, retry: null };
      }
      return { ...s, game, showTrick: trickJustCompleted(s.game, game) };
    }
    case 'auction-ai': {
      const seat=pendingAiSeat(s), g=s.game, d=e.decision;
      if (stale(s, e.epoch)) return s;
      if (seat===null || !g || !['bidding','declaring'].includes(g.phase) || d.key!==auctionKey(g,s.sessionId)) return s;
      if ((g.phase==='bidding' && d.action.type!=='bid') || (g.phase==='declaring' && d.action.type!=='declare')) return s;
      try {
        const game=applyAction(g,d.action);
        return {...s,game,aiMoves:s.aiMoves+1,auctionSurveys:d.survey ? {...s.auctionSurveys,[`${g.handNumber}:${seat}`]:d.survey} : s.auctionSurveys};
      } catch { return s; }
    }
    case 'native-ai': {
      const seat = pendingAiSeat(s);
      if (stale(s, e.epoch) || seat === null || !s.game || s.game.phase !== 'playing' || !isNative(s.settings.difficulty)) return s;
      const req = requestOf(s.game, seat, s.sessionId);
      const wanted = s.settings.difficulty === 'native-l1' ? 'l1-default' : 'l1-partner-rollout';
      if (requestKey(req) !== requestKey(e.receipt.identity.request) || e.receipt.identity.game_id !== s.sessionId
        || e.receipt.identity.hand_number !== s.game.handNumber || e.receipt.identity.player.name !== wanted) return s;
      const game = applyAction(s.game, checkedAction(s.game, req, e.receipt));
      const key = `${s.game.handNumber}:${req.plays.length / 2}`;
      return { ...s, game, aiMoves: s.aiMoves + 1, showTrick: trickJustCompleted(s.game, game),
        nativeReceipts: { ...s.nativeReceipts, [key]: e.receipt.id } };
    }
    case 'ai': {
      const seat = pendingAiSeat(s);
      if (stale(s, e.epoch) || seat === null || !s.game) return s;
      const choose = e.choose ?? chooseAction;
      const action = choose(s.game, seat, s.settings.difficulty, aiRand(s.game, s.aiMoves));
      const game = applyAction(s.game, action);
      return {
        ...s,
        game,
        aiMoves: s.aiMoves + 1,
        showTrick: trickJustCompleted(s.game, game),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Timing (used by App.tsx; pure functions of state so they're testable)
// ---------------------------------------------------------------------------

/** Readable AI pacing, ~500–900ms, with a little deterministic variety. */
export function aiDelayMs(s: AppState): number {
  const base = s.game?.phase === 'declaring' ? 700 : 550;
  return base + (s.aiMoves % 4) * 80; // 550..790 / 700..940 capped below
}

/** Hold all dominoes still for two seconds, then gather them to the winner. */
export const TRICK_HOLD_MS = 2000;
export const TRICK_SHOW_MS = TRICK_HOLD_MS + 300;

// ---------------------------------------------------------------------------
// Persistence (storage-agnostic so tests can pass a fake)
// ---------------------------------------------------------------------------

export interface SavedState {
  readonly v: 1;
  readonly showTrick?: boolean;
  readonly settings: Settings;
  readonly seed: string;
  readonly game: GameState | null;
  readonly aiMoves: number;
  readonly sessionId?: string;
  readonly nativeReceipts?: Record<string, string>;
  readonly auctionSurveys?: Record<string, AuctionEvidence>;
  /** Absent in saves from before undo; they load as generation 0 with no retries. */
  readonly epoch?: number;
  readonly retry?: HandRetry | null;
  readonly practiceHands?: readonly number[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = 'plunge:save:v1';

export function toSaved(s: AppState): SavedState {
  return { v: 1, showTrick: s.showTrick, settings: s.settings, seed: s.seed, game: s.game, aiMoves: s.aiMoves,
    sessionId: s.sessionId, nativeReceipts: s.nativeReceipts, auctionSurveys: s.auctionSurveys,
    epoch: s.epoch, retry: s.retry, practiceHands: s.practiceHands };
}

const HAND_NUMBER = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) >= 1;

function validRetry(r: unknown): boolean {
  if (r === null || r === undefined) return true;
  const v = r as HandRetry;
  return typeof v === 'object' && HAND_NUMBER(v.handNumber) && HAND_NUMBER(v.attempt)
    && (v.kind === 'undo' || v.kind === 'restart') && Number.isSafeInteger(v.kept) && v.kept >= 0
    && typeof v.sawResult === 'boolean' && typeof v.from === 'object' && v.from !== null
    && (v.from.code === null || typeof v.from.code === 'string') && typeof v.from.phase === 'string';
}

export function saveApp(storage: StorageLike, s: AppState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(toSaved(s)));
  } catch {
    // storage full / private mode — losing the save is fine
  }
}
/** A shared table keeps the solo save underneath; only the hints choice travels home. */
export function saveShowHints(storage: StorageLike, showHints: boolean): void {
  try {
    const saved = loadApp(storage);
    if (!saved) return;
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, settings: { ...saved.settings, showHints } }));
  } catch { /* As above. */ }
}

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'onyx', 'walt', 'native-l1', 'native-partner'];
const PRESETS: readonly Preset[] = ['casual', 'tournament'];

export function loadApp(storage: StorageLike): SavedState | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedState & { settings: Settings & { nelloCounterexamples?: boolean } };
    if (p === null || typeof p !== 'object' || p.v !== 1) return null;
    if (!DIFFICULTIES.includes(p.settings?.difficulty)) return null;
    if (!PRESETS.includes(p.settings?.preset)) return null;
    if (p.settings.nelloCounterexamples !== undefined && typeof p.settings.nelloCounterexamples !== 'boolean') return null;
    if (p.settings.nelloPreview !== undefined && typeof p.settings.nelloPreview !== 'boolean') return null;
    if (p.settings.thinkDeeper !== undefined && typeof p.settings.thinkDeeper !== 'boolean') return null;
    if (p.settings.showHints !== undefined && typeof p.settings.showHints !== 'boolean') return null;
    if (p.showTrick !== undefined && typeof p.showTrick !== 'boolean') return null;
    if (typeof p.seed !== 'string' || typeof p.aiMoves !== 'number') return null;
    if (p.sessionId !== undefined && (typeof p.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.sessionId))) return null;
    if (p.nativeReceipts !== undefined && (typeof p.nativeReceipts !== 'object' || p.nativeReceipts === null
      || Object.entries(p.nativeReceipts).some(([k,v]) => !/^\d+:\d+$/.test(k) || typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)))) return null;
    if (p.epoch !== undefined && (!Number.isSafeInteger(p.epoch) || p.epoch < 0)) return null;
    if (!validRetry(p.retry)) return null;
    if (p.practiceHands !== undefined && (!Array.isArray(p.practiceHands) || !p.practiceHands.every(HAND_NUMBER))) return null;
    if (p.game !== null) {
      const g = p.game;
      if (typeof g !== 'object' || typeof g.phase !== 'string') return null;
      if (!Array.isArray(g.hands) || g.hands.length !== 4) return null;
      if (!Array.isArray(g.marks) || g.marks.length !== 2) return null;
    }
    const { nelloCounterexamples, ...settings } = p.settings;
    return { ...p, settings: { ...settings, thinkDeeper: settings.thinkDeeper ?? false, showHints: settings.showHints ?? true,
      nelloPreview: settings.nelloPreview ?? nelloCounterexamples ?? false } };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Friendly copy (pure, testable)
// ---------------------------------------------------------------------------

export const PIP_SUIT_NAMES: readonly string[] = [
  'blanks', 'aces', 'deuces', 'treys', 'fours', 'fives', 'sixes',
];

export function bidLabel(bid: Bid): string {
  switch (bid.kind) {
    case 'pass':
      return 'Pass';
    case 'points':
      return String(bid.value);
    case 'marks': {
      const base = bid.value === 1 ? '1 mark' : `${bid.value} marks`;
      if (bid.special === 'plunge') return `Plunge! (${base})`;
      if (bid.special === 'splash') return `Splash! (${base})`;
      if (bid.special === 'nello') return `Nel-O (${base})`;
      return base;
    }
  }
}

export function contractLabel(c: Contract): string {
  const marks = c.kind === 'points' ? 1 : c.value;
  const m = marks === 1 ? '1 mark' : `${marks} marks`;
  switch (c.kind) {
    case 'points': return `${c.value}`;
    case 'marks': return m;
    case 'nello': return `Nel-O, ${m}`;
    case 'plunge': return `Plunge, ${m}`;
    case 'splash': return `Splash, ${m}`;
    case 'sevens': return `Sevens, ${m}`;
  }
}

export function declLabel(d: Declaration): string {
  switch (d.type) {
    case 'pip': return PIP_SUIT_NAMES[d.pip] ?? String(d.pip);
    case 'doubles': return 'doubles';
    case 'no-trump': return 'follow me';
    case 'nello': return 'Nel-O';
    case 'sevens': return 'sevens';
  }
}

/**
 * Trump chip for the in-play info bar — what was called, kept short.
 * Spells out the doubles treatment for no-trump and Nel-O, where it matters.
 */
export function trumpChip(g: GameState): string | null {
  const d = g.declaration;
  if (!d) return null;
  switch (d.type) {
    case 'pip':
      return `trump: ${PIP_SUIT_NAMES[d.pip]}`;
    case 'doubles':
      return 'trump: doubles';
    case 'no-trump':
      switch (g.config.noTrumpDoubles) {
        case 'high': return 'no trump — doubles high';
        case 'low': return 'no trump — doubles low';
        case 'own-suit': return 'no trump — doubles own suit';
      }
      break;
    case 'nello':
      switch (g.config.nelloDoubles) {
        case 'own-suit': return 'Nel-O — doubles own suit';
        case 'high': return 'Nel-O — doubles high';
        case 'low': return 'Nel-O — doubles low';
        case 'own-suit-inverted': return 'Nel-O — doubles own suit, 0-0 high';
      }
      break;
    case 'sevens':
      return 'Sevens — closest to 7 wins';
  }
}

/**
 * The suit the displayed trick's lead calls for ("sixes", "trumps",
 * "doubles"), or null when nothing is on the table.
 */
export function ledChip(g: GameState, plays: readonly PlayRecord[]): string | null {
  const lead = plays[0];
  if (!lead || !g.rules) return null;
  const led = ledSuitOf(fromId(lead.domino), g.rules);
  if (led === CALLED_SUIT) {
    return g.rules.called.kind === 'doubles' ? 'doubles' : 'trumps';
  }
  return PIP_SUIT_NAMES[led] ?? null;
}

/**
 * Shown (with animated dots) while a slow AI — walt at an opening lead, or
 * pricing an auction — is genuinely computing, so a long pause reads as
 * thought, not a hang.
 */
export function thinkingCopy(seat: Seat): string {
  return `${SEAT_NAMES[seat] ?? 'Somebody'}'s thinking it over`;
}

export interface HandOverCopy {
  readonly title: string;
  readonly detail: string;
}

export function handOverCopy(g: GameState): HandOverCopy {
  if (g.thrownIn) {
    return {
      title: 'Nobody wanted it',
      detail: "All four passed — shake 'em up and go again.",
    };
  }
  const r = g.handResult;
  if (!r) return { title: 'Hand over', detail: '' };
  const declTeam = teamOf(r.declarer);
  const declName = SEAT_NAMES[r.declarer] ?? 'Somebody';
  const marks = r.marks === 1 ? '1 mark' : `${r.marks} marks`;
  const usWon = r.team === 0;
  if (r.made) {
    if (declTeam === 0) {
      const who = r.declarer === HUMAN_SEAT ? 'You made it!' : `${declName} made it!`;
      return { title: who, detail: `${cap(r.reason)}. ${marks} for us.` };
    }
    return { title: 'They made it', detail: `${cap(r.reason)}. ${marks} their way.` };
  }
  if (usWon) {
    const held =
      r.contract.kind === 'points'
        ? `Set! Y'all held 'em to ${g.points[declTeam] ?? 0}`
        : 'Set!';
    return { title: held, detail: `${cap(r.reason)}. ${marks} for us.` };
  }
  return { title: 'Set.', detail: `${cap(r.reason)}. ${marks} their way.` };
}

export function gameOverCopy(g: GameState): HandOverCopy {
  if (g.winner === 0) {
    return {
      title: "Y'all win!",
      detail: `${SEAT_NAMES[2]} gives you a wink across the table. That makes ALL.`,
    };
  }
  return {
    title: "They got y'all this time",
    detail: `${SEAT_NAMES[1]} and ${SEAT_NAMES[3]} tip their hats. Shake it back and run it again.`,
  };
}

function cap(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
