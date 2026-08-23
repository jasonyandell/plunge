/**
 * walt — the level-1 seat: declare and play for straight points-and-marks
 * 42, decided by the exact sampling-stack solver compiled to wasm
 * (walt.wasm, ~300 KB, zero imports).
 *
 * BIDDING IS DELEGATED TO `hard` — deliberately. walt's bid handler prices
 * P(make) against its level-0 field model: defenders who each sample 8
 * worlds and best-respond to uniform-random play (SCENARIO-PLAYER.md §3.2,
 * §3.5). Against that defense most dealt hands "make" high bids, so the
 * price curve saturates at 100% and no theta can repair it — walt's own
 * 200-hand bidcurve corpus bids 124/200 hands even at theta = 1 (mean final
 * bid ~34). At the table that read as three seats bidding 40, 41, 42. The
 * model is exactly what §7.2 says it is — model-relative, not
 * game-theoretic — and its bidding baseline is documented as not yet built,
 * so the auction uses hard's club-player bidder until walt can price
 * against a stronger field. Declaring stays with walt: picking the best
 * trump for a hand at a fixed bid is pricing it is good at.
 *
 * SYNC/ASYNC — the onyx pattern, one level up. `chooseAction` is synchronous;
 * walt's solver is slow (opening leads ≈ seconds) and lives in a Web Worker.
 * We bridge with a response cache keyed on the exact request:
 *   - `prewarmWalt(state, seat)` builds the request from the seat's
 *     Observation, runs it in the worker, and caches the response. App.tsx
 *     awaits this BEFORE dispatching the synchronous 'ai' step.
 *   - the synchronous `waltAction` rebuilds the identical request (the
 *     builders are pure) and looks the response up. Hit → walt's choice,
 *     checked against the legal actions; any miss, error, or out-of-scope
 *     contract (nello, sevens, plunge, splash, sat-out partner) falls back to
 *     `hard`. walt is always legal and never blocks.
 *
 * CONFORMANCE — every play response carries walt's independently derived
 * trick leader and banked points; we assert them against the engine on every
 * decision (two independent rules engines agreeing on every replay). A
 * mismatch is logged, counted, and the response discarded → hard fallback.
 *
 * In tests (no Worker, no fetch) pass the wasm bytes to `preloadWalt` and the
 * solver runs in-process instead.
 */

import { type Action, type GameState, type Seat } from '../../engine';
import { type Observation, observe } from '../observation';
import { hardAction } from '../hard';
import {
  Walt,
  type BidRequest,
  type DeclareRequest,
  type DeclareResponse,
  type PlayRequest,
  type PlayResponse,
} from './walt';
import {
  WALT_N,
  WALT_N0,
  type WaltTuning,
  conformanceFailure,
  declareActionOf,
  declareRequestOf,
  playActionOf,
  playRequestOf,
} from './requests';
import type { WaltKind, WaltWorkerRequest, WaltWorkerResponse } from './worker';

type WaltRequest = PlayRequest | BidRequest | DeclareRequest;
type Backend = (kind: WaltKind, req: WaltRequest) => Promise<unknown>;

let backendPromise: Promise<Backend | null> | null = null;
let backend: Backend | null = null;

let tuning: WaltTuning = { n: WALT_N, n0: WALT_N0 };

/** Override sample sizes (tests use small n for speed; strength suffers). */
export function configureWalt(t: Partial<WaltTuning>): void {
  tuning = { ...tuning, ...t };
}

/** Observability for tests: how often the real solver decided vs fell back. */
export const waltCounters = {
  netPlays: 0,
  netDeclares: 0,
  conformanceFailures: 0,
};

// ---- backends -------------------------------------------------------------

function workerBackend(): Backend {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  w.onmessage = (e: MessageEvent) => {
    const { id, resp, error } = e.data as WaltWorkerResponse;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error !== undefined) p.reject(new Error(error));
    else p.resolve(resp);
  };
  w.onerror = () => {
    for (const p of pending.values()) p.reject(new Error('walt worker error'));
    pending.clear();
  };
  return (kind, req) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const msg: WaltWorkerRequest = { id, kind, req };
      w.postMessage(msg);
    });
}

async function directBackend(bytes: Uint8Array): Promise<Backend> {
  const walt = await Walt.load(bytes);
  return async (kind, req) => {
    // Yield a macrotask before each solve: the call is long and synchronous,
    // and a microtask-only await chain would starve timers and IPC (e.g. the
    // test runner's RPC) for the whole run.
    await new Promise((r) => setTimeout(r, 0));
    return kind === 'play'
      ? walt.play(req as PlayRequest)
      : kind === 'bid'
        ? walt.bid(req as BidRequest)
        : walt.declare(req as DeclareRequest);
  };
}

/**
 * Kick off solver load (idempotent). In the browser this spawns the Web
 * Worker; pass the wasm bytes for non-browser environments (tests) to run
 * in-process. A failure leaves the backend null so walt degrades to hard
 * without crashing the app.
 */
export function preloadWalt(bytes?: Uint8Array): Promise<Backend | null> {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    if (bytes) backend = await directBackend(bytes);
    else if (typeof Worker !== 'undefined') backend = workerBackend();
    else return null;
    return backend;
  })().catch((e: unknown) => {
    console.warn('walt failed to load; falling back to hard.', e);
    backendPromise = null;
    return null;
  });
  return backendPromise;
}

/** True once the backend is up (worker spawned / wasm instantiated). */
export function waltReady(): boolean {
  return backend !== null;
}

// ---- response cache -------------------------------------------------------

const cache = new Map<string, unknown>();

function keyOf(kind: WaltKind, req: WaltRequest): string {
  return `${kind}|${JSON.stringify(req)}`;
}

/** The walt request for this observation, or null when out of scope. */
function requestFor(obs: Observation): { kind: WaltKind; req: WaltRequest } | null {
  switch (obs.phase) {
    case 'bidding':
      // Deliberately out of scope → hard's bidder (see the header: walt's
      // bid pricing saturates against its level-0 field model).
      return null;
    case 'declaring': {
      const req = declareRequestOf(obs, tuning);
      return req && { kind: 'declare', req };
    }
    case 'playing': {
      const req = playRequestOf(obs, tuning);
      return req && { kind: 'play', req };
    }
    default:
      return null;
  }
}

/**
 * Async: ensure walt's response for `seat`'s pending decision is cached.
 * Resolves when the subsequent synchronous `waltAction` will hit the cache
 * (or immediately for out-of-scope states, which stay a hard fallback).
 * Never rejects — any failure just leaves the cache cold.
 */
export async function prewarmWalt(state: GameState, seat: Seat): Promise<void> {
  const obs = observe(state, seat);
  const rr = requestFor(obs);
  if (!rr) return;
  const key = keyOf(rr.kind, rr.req);
  if (cache.has(key)) return;
  const be = await preloadWalt();
  if (!be) return;
  try {
    const resp = await be(rr.kind, rr.req);
    if (rr.kind === 'play') {
      const fail = conformanceFailure(obs, resp as PlayResponse);
      if (fail) {
        waltCounters.conformanceFailures++;
        console.warn(`walt conformance mismatch (${fail}); falling back to hard.`);
        return;
      }
    }
    cache.set(key, resp);
  } catch (e) {
    console.warn('walt request failed; falling back to hard.', e);
  }
}

// ---- the policy -----------------------------------------------------------

/**
 * walt's choice. Pure given the response cache: a hit plays walt's decision
 * (verified legal); any miss or out-of-scope state falls back to `hard`.
 */
export function waltAction(
  obs: Observation,
  acts: readonly Action[],
  rand: () => number,
): Action {
  if (acts.length === 1) return acts[0]!;
  const rr = requestFor(obs);
  if (!rr) return hardAction(obs, acts, rand);
  const resp = cache.get(keyOf(rr.kind, rr.req));
  if (resp === undefined) return hardAction(obs, acts, rand);

  switch (rr.kind) {
    case 'play': {
      const a = playActionOf(resp as PlayResponse, acts);
      if (a) waltCounters.netPlays++;
      return a ?? hardAction(obs, acts, rand);
    }
    case 'bid':
      // Unreachable — requestFor never yields a bid request (delegated to
      // hard) — but the worker protocol still knows the kind.
      return hardAction(obs, acts, rand);
    case 'declare': {
      const a = declareActionOf(resp as DeclareResponse, acts);
      if (a) waltCounters.netDeclares++;
      return a ?? hardAction(obs, acts, rand);
    }
  }
}
