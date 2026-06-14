/**
 * onyx — the in-browser belief student.
 *
 * onyx is the Gus auction-conditioned student (a distilled single-forward
 * transformer), exported to ONNX (mk5-main/scratch/champion-run/export_onyx.py)
 * and run with onnxruntime-web. It is a PLAY policy: it reads the pi_me head, a
 * softmax over the 7 slots of the player's CURRENT hand.
 *
 * Scope (champion contract): onyx only knows STRAIGHT-42 declarations it trained
 * on — pip trumps 0..6, doubles (7), and no-trump / follow-me (9). For every
 * other phase (bidding, declaring) and every out-of-scope contract (nello,
 * sevens, plunge, splash, doubles-as-suit) it falls back to the existing `hard`
 * policy. It never fabricates a bid or a declaration.
 *
 * SLOT MAPPING — the load-bearing detail. The Gus training code maps
 * pi_me_logits[k] to `my_current[k]` (gus/model/strategy_features.py:301-306):
 * the k-th domino of the CURRENT hand, in initial-deal order, played tiles
 * removed. plunge's `Observation.hand` is exactly that (applyPlay removes by
 * filter, preserving order), so pi_me_logits[k] ↔ obs.hand[k] directly. We mask
 * to legal plays and argmax.
 *
 * SYNC/ASYNC — `chooseAction` is synchronous (the store reducer and the test
 * harness call it synchronously); ONNX inference is async. We bridge with a
 * module-level prediction cache:
 *   - `predictAsync` runs the session and caches pi_me_logits keyed on the
 *     featurized state. The UI (App.tsx) pre-warms the cache for the pending
 *     onyx seat BEFORE dispatching the synchronous 'ai' step.
 *   - the synchronous `onyxAction` looks the prediction up; on a hit it plays
 *     the net's choice, on a miss (cold cache, no session, or out-of-scope) it
 *     falls back to `hard`. So onyx is always legal and never blocks.
 */

import {
  type Action,
  type Declaration,
  type DominoId,
  type GameState,
  type Seat,
} from '../engine';
import { type Observation, observe } from './observation';
import { hardAction } from './hard';
import {
  type FeatureInput,
  buildTensors,
  idToDomId,
} from './onyx-features';

// onnxruntime-web is loaded lazily so the engine/tests never pull in the wasm
// runtime unless onyx is actually used in the browser.
type Ort = typeof import('onnxruntime-web');
type OrtSession = import('onnxruntime-web').InferenceSession;
let ortMod: Ort | null = null;
let sessionPromise: Promise<unknown> | null = null;
let session: OrtSession | null = null;

/** Where the bundled model is served from (public/models/onyx.onnx). */
export const ONYX_MODEL_URL = '/models/onyx.onnx';

// ---- declaration scope ----------------------------------------------------

/** decl_id for a plunge Declaration, or null if the champion never trained on it. */
export function declIdOf(decl: Declaration | null): number | null {
  if (!decl) return null;
  switch (decl.type) {
    case 'pip':
      return decl.pip; // 0..6
    case 'doubles':
      return 7;
    case 'no-trump':
      return 9;
    case 'nello':
    case 'sevens':
      return null; // out of scope — fall back to hard
  }
}

// ---- auction encoding -----------------------------------------------------

/**
 * Raw per-seat bid values for the auction feature, current-player POV inputs.
 * plunge marks: 1 mark = "42", N marks = 42*N (so 1 mark -> bid_norm 1.0,
 * exactly the corpus's max points bid; >=2 marks -> is_marks). points bids
 * (30..41) pass through; pass -> 0. Returns {bids, bidder, bidValue} or null
 * when the auction is unusable (no positive bid).
 */
export function auctionInputsFromObs(
  obs: Observation,
): { bids: number[]; bidder: number; bidValue: number } | null {
  const bids = [0, 0, 0, 0];
  let bidder = -1;
  let bidValue = 0;
  for (const sb of obs.bids) {
    const v = rawBidValue(sb.bid);
    if (v <= 0) continue;
    bids[sb.seat] = v;
    if (v > bidValue) {
      bidValue = v;
      bidder = sb.seat;
    }
  }
  if (bidder < 0) return null;
  return { bids, bidder, bidValue };
}

function rawBidValue(bid: { kind: string; value?: number }): number {
  if (bid.kind === 'points') return bid.value ?? 0;
  if (bid.kind === 'marks') return 42 * (bid.value ?? 1);
  return 0; // pass
}

// ---- feature input from an Observation ------------------------------------

/**
 * Build the canonical FeatureInput from a play-phase Observation, or null if
 * onyx is out of scope (not playing, out-of-scope declaration, sitting out).
 *
 * cp's hand is taken straight from obs.hand (== Gus `my_current`); the other
 * seats' hands are unused by the featurizer, so a placeholder suffices.
 */
export function featureInputFromObs(obs: Observation): {
  input: FeatureInput;
  cpHand: readonly DominoId[];
} | null {
  if (obs.phase !== 'playing') return null;
  const declId = declIdOf(obs.declaration);
  if (declId === null) return null;
  if (obs.contract && (obs.contract.kind === 'nello' || obs.contract.kind === 'sevens')) {
    return null;
  }
  const cp = obs.seat;

  // Chronological prior plays: completed tricks in order, then the current trick.
  const plays = [];
  for (const t of obs.tricks) {
    for (const p of t.plays) plays.push({ seat: p.seat, domId: idToDomId(p.domino) });
  }
  for (const p of obs.currentTrick) {
    plays.push({ seat: p.seat, domId: idToDomId(p.domino) });
  }

  // hands: only hands[cp] is read by the tokenizer. cp's "initial hand" in
  // deal order = obs.hand (still unplayed) re-merged with what cp has played.
  // But the tokenizer only needs my_current (== obs.hand), so we hand it the
  // current hand directly and a placeholder elsewhere. The MINE tokens and the
  // slot mapping both derive from obs.hand, so they stay consistent.
  const hands: number[][] = [[], [], [], []];
  hands[cp] = obs.hand.map(idToDomId);

  return {
    input: { hands, declId, plays, cp },
    cpHand: obs.hand,
  };
}

// ---- prediction cache + async session -------------------------------------

const cache = new Map<string, Float32Array>();

function cacheKey(t: ReturnType<typeof buildTensors>): string {
  // tokens fully determine the public state; voids/bids are derived, but
  // include them defensively (cheap; lengths are small).
  return `${t.tokens.join(',')}|${t.voids.join(',')}|${t.bids.join(',')}`;
}

/**
 * Kick off model load (idempotent). Call once at startup. `source` overrides
 * the default served URL — pass a Uint8Array of the .onnx bytes for non-browser
 * environments (tests). A load failure leaves the session null so onyx degrades
 * to hard without crashing the app.
 */
export function preloadOnyx(source: string | Uint8Array = ONYX_MODEL_URL): Promise<unknown> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    ortMod = await import('onnxruntime-web');
    const opts = { executionProviders: ['wasm'] as const };
    session = await (typeof source === 'string'
      ? ortMod.InferenceSession.create(source, opts)
      : ortMod.InferenceSession.create(source, opts));
    return session;
  })().catch((e) => {
    // Leave session null → onyx falls back to hard. Don't crash the app.
    console.warn('onyx model failed to load; falling back to hard.', e);
    sessionPromise = null;
    return null;
  });
  return sessionPromise;
}

/** True once the session is ready for synchronous cache hits. */
export function onyxReady(): boolean {
  return session !== null;
}

/**
 * Async: ensure pi_me_logits for `obs` are in the cache. Safe to call before
 * each onyx step from the UI. Resolves to the logits, or null if out of scope
 * / the session never loaded.
 */
export async function predictAsync(obs: Observation): Promise<Float32Array | null> {
  const fi = featureInputFromObs(obs);
  if (!fi) return null;
  await preloadOnyx();
  if (!session || !ortMod) return null;

  const auc = auctionInputsFromObs(obs);
  const t = buildTensors(
    fi.input,
    auc ? auc.bids : null,
    auc ? auc.bidder : null,
    auc ? auc.bidValue : null,
  );
  const key = cacheKey(t);
  const hit = cache.get(key);
  if (hit) return hit;

  const ort = ortMod;
  const tokens = new ort.Tensor(
    'int64',
    BigInt64Array.from(t.tokens, (x) => BigInt(x)),
    [1, 33, 5],
  );
  const attn = new ort.Tensor('bool', Uint8Array.from(t.attn), [1, 33]);
  const world = new ort.Tensor('float32', new Float32Array(28 * 3), [1, 28, 3]);
  const voids = new ort.Tensor('float32', t.voids, [1, 24]);
  const bids = new ort.Tensor('float32', t.bids, [1, 28]);

  const out = await session.run({ tokens, attn, world, voids, bids });
  const pi = out['pi_me_logits']!.data as Float32Array;
  const logits = Float32Array.from(pi);
  cache.set(key, logits);
  return logits;
}

/**
 * Convenience for the UI: pre-warm the prediction cache for `seat` in `state`
 * (builds the Observation, runs inference, caches). Resolves when the
 * subsequent synchronous `onyxAction` for this state will hit the cache (or
 * immediately for out-of-scope states, which deliberately stay a hard fallback).
 */
export async function prewarmOnyx(state: GameState, seat: Seat): Promise<void> {
  await predictAsync(observe(state, seat));
}

/** Synchronous cache lookup (no inference). Null on miss / out of scope. */
export function lookupPrediction(obs: Observation): Float32Array | null {
  const fi = featureInputFromObs(obs);
  if (!fi) return null;
  const auc = auctionInputsFromObs(obs);
  const t = buildTensors(
    fi.input,
    auc ? auc.bids : null,
    auc ? auc.bidder : null,
    auc ? auc.bidValue : null,
  );
  return cache.get(cacheKey(t)) ?? null;
}

// ---- the policy -----------------------------------------------------------

/**
 * onyx's choice. Pure given the prediction cache: a cache hit plays the net's
 * legal argmax; any miss or out-of-scope state falls back to `hard`.
 */
export function onyxAction(
  obs: Observation,
  acts: readonly Action[],
  rand: () => number,
): Action {
  if (acts.length === 1) return acts[0]!;

  // Only the play phase is in scope; bidding/declaring always defer to hard.
  if (obs.phase !== 'playing') return hardAction(obs, acts, rand);

  const fi = featureInputFromObs(obs);
  if (!fi) return hardAction(obs, acts, rand);

  const logits = lookupPrediction(obs);
  if (!logits) return hardAction(obs, acts, rand);

  // Legal plays as DominoIds.
  const legalIds = acts
    .filter((a): a is Extract<Action, { type: 'play' }> => a.type === 'play')
    .map((a) => a.domino);
  if (legalIds.length === 0) return hardAction(obs, acts, rand);
  const legalSet = new Set<DominoId>(legalIds);

  // pi_me_logits[k] ↔ cpHand[k] (== obs.hand[k]). Mask to legal, argmax.
  let bestId: DominoId | null = null;
  let bestLogit = -Infinity;
  for (let k = 0; k < fi.cpHand.length && k < 7; k++) {
    const id = fi.cpHand[k]!;
    if (!legalSet.has(id)) continue;
    const l = logits[k]!;
    if (l > bestLogit) {
      bestLogit = l;
      bestId = id;
    }
  }
  if (bestId === null) return hardAction(obs, acts, rand);
  return { type: 'play', domino: bestId };
}
