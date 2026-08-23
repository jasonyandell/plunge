/**
 * Pure mapping between plunge's `Observation` and walt's request/response
 * shapes (see walt.ts + README in this directory). No wasm here — everything
 * is a pure function of the observation, so the same builder produces the
 * identical request at pre-warm time (async, in the worker) and at decision
 * time (sync cache lookup), and it all unit-tests without a solver.
 *
 * Scope (the walt contract): straight points-and-marks 42 only — pip trumps,
 * doubles, no-trump — and no sat-out-partner rule in play. Every builder
 * returns null when out of scope; the caller falls back to `hard`.
 */

import {
  type Action,
  type Bid,
  type Contract,
  type Declaration,
  type DominoId,
  type Seat,
  fromId,
  toSeed,
} from '../../engine';
import { type Observation } from '../observation';
import {
  type BidRequest,
  type BidResponse,
  type DeclareRequest,
  type DeclareResponse,
  type PlayRequest,
  type PlayResponse,
  pipsOf,
  tileOf,
} from './walt';

/** Outer belief sample size. Strength vs latency; walt's shipped default. */
export const WALT_N = 40;
/** Modeled level-0 mind sample size. */
export const WALT_N0 = 8;
/**
 * Bid while P(make) >= theta. NOTE: plunge currently does not use walt's
 * bidder at all (see src/ai/walt/index.ts header — the price curve
 * saturates against walt's level-0 field model, so even theta = 1 overbids
 * at the table). The builders below are kept, tested, and ready for a
 * walt-side re-pricing against a stronger field.
 */
export const WALT_THETA: readonly [number, number] = [19, 20];

export interface WaltTuning {
  readonly n: number;
  readonly n0: number;
}

// ---- tile id conversion ---------------------------------------------------

/** plunge "65"-style DominoId → walt triangular tile id. */
export function tileOfId(id: DominoId): number {
  const d = fromId(id);
  return tileOf(d.high, d.low);
}

/** walt triangular tile id → plunge DominoId. */
export function idOfTile(tile: number): DominoId {
  const [h, l] = pipsOf(tile);
  return `${h}${l}`;
}

// ---- scope ----------------------------------------------------------------

/** walt decl id for a plunge Declaration, or null if out of walt's scope. */
export function waltDeclId(decl: Declaration | null): number | null {
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
      return null;
  }
}

/** plunge Declaration for a walt decl id, or null for an unknown id. */
export function waltDeclarationOf(id: number): Declaration | null {
  if (id >= 0 && id <= 6) return { type: 'pip', pip: id as 0 | 1 | 2 | 3 | 4 | 5 | 6 };
  if (id === 7) return { type: 'doubles' };
  if (id === 9) return { type: 'no-trump' };
  return null;
}

/**
 * The contract as walt's `bid` field: a points contract is its value
 * (30..41); a straight marks contract is 42 (any marks level — the play
 * target is all 42 points either way). Null for every other contract kind.
 */
export function waltContractBid(contract: Contract | null): number | null {
  if (!contract) return null;
  if (contract.kind === 'points') return contract.value;
  if (contract.kind === 'marks') return 42;
  return null;
}

// ---- request builders -----------------------------------------------------

/**
 * Fixed per hand so hands replay deterministically (walt is deterministic per
 * request). Derived from public state only, so pre-warm and lookup agree.
 */
export function handSeed(obs: Observation): number {
  return toSeed(`walt/${obs.handNumber}/${obs.shaker}/${obs.marks[0]}-${obs.marks[1]}`);
}

/**
 * The seat's 7 ORIGINALLY DEALT tiles: remaining hand plus its own plays from
 * the trick record. Sorted (walt treats the hand as a set; a canonical order
 * keeps the request bytes — and the cache key — stable).
 */
export function dealtHandTiles(obs: Observation): number[] {
  const ids: DominoId[] = [...obs.hand];
  for (const t of obs.tricks) {
    for (const p of t.plays) if (p.seat === obs.seat) ids.push(p.domino);
  }
  for (const p of obs.currentTrick) if (p.seat === obs.seat) ids.push(p.domino);
  return ids.map(tileOfId).sort((a, b) => a - b);
}

/** Full chronological play record as flat (seat, tile) pairs. */
export function playPairs(obs: Observation): number[] {
  const pairs: number[] = [];
  for (const t of obs.tricks) {
    for (const p of t.plays) pairs.push(p.seat, tileOfId(p.domino));
  }
  for (const p of obs.currentTrick) pairs.push(p.seat, tileOfId(p.domino));
  return pairs;
}

export function playRequestOf(obs: Observation, tuning: WaltTuning): PlayRequest | null {
  if (obs.phase !== 'playing' || obs.sittingOut !== null) return null;
  const decl = waltDeclId(obs.declaration);
  const bid = waltContractBid(obs.contract);
  if (decl === null || bid === null || obs.declarer === null) return null;
  const hand = dealtHandTiles(obs);
  if (hand.length !== 7) return null;
  return {
    decl,
    bid,
    seat: obs.seat,
    bidder: obs.declarer,
    hand,
    plays: playPairs(obs),
    n: tuning.n,
    n0: tuning.n0,
    seed: handSeed(obs),
    race: true,
  };
}

/** Minimum viable bid from the auction so far: current high + 1, or 30. */
export function bidNeedOf(obs: Observation): number {
  let high = 0;
  for (const sb of obs.bids) {
    const b = sb.bid;
    const v = b.kind === 'points' ? b.value : b.kind === 'marks' ? 42 * b.value : 0;
    if (v > high) high = v;
  }
  return high === 0 ? 30 : high + 1;
}

export function bidRequestOf(obs: Observation, tuning: WaltTuning): BidRequest | null {
  if (obs.phase !== 'bidding' || obs.hand.length !== 7) return null;
  const need = bidNeedOf(obs);
  // Above 42 the auction is in marks-escalation territory walt doesn't price.
  if (need > 42) return null;
  return {
    hand: obs.hand.map(tileOfId).sort((a, b) => a - b),
    need,
    theta: [WALT_THETA[0], WALT_THETA[1]],
    n: tuning.n,
    n0: tuning.n0,
    seed: handSeed(obs),
  };
}

export function declareRequestOf(obs: Observation, tuning: WaltTuning): DeclareRequest | null {
  if (obs.phase !== 'declaring' || obs.hand.length !== 7 || obs.sittingOut !== null) return null;
  const bid = waltContractBid(obs.contract);
  if (bid === null) return null;
  return {
    hand: obs.hand.map(tileOfId).sort((a, b) => a - b),
    bid,
    n: tuning.n,
    n0: tuning.n0,
    seed: handSeed(obs),
  };
}

// ---- response → legal action ----------------------------------------------

export function playActionOf(resp: PlayResponse, acts: readonly Action[]): Action | null {
  const id = idOfTile(resp.choice);
  return acts.find((a) => a.type === 'play' && a.domino === id) ?? null;
}

function sameBid(a: Bid, b: Bid): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'pass') return true;
  if (a.kind === 'points') return b.kind === 'points' && a.value === b.value;
  // Marks: walt only ever means a PLAIN marks bid, never plunge/splash/nello.
  return (
    b.kind === 'marks' && a.value === b.value && a.special === undefined && b.special === undefined
  );
}

export function bidActionOf(resp: BidResponse, acts: readonly Action[]): Action | null {
  const want: Bid | null =
    resp.action === 'pass'
      ? { kind: 'pass' }
      : resp.bid === undefined
        ? null
        : resp.bid >= 30 && resp.bid <= 41
          ? { kind: 'points', value: resp.bid }
          : resp.bid === 42
            ? { kind: 'marks', value: 1 }
            : null;
  if (!want) return null;
  return acts.find((a) => a.type === 'bid' && sameBid(a.bid, want)) ?? null;
}

function sameDecl(a: Declaration, b: Declaration): boolean {
  if (a.type !== b.type) return false;
  return a.type !== 'pip' || b.type !== 'pip' || a.pip === b.pip;
}

export function declareActionOf(resp: DeclareResponse, acts: readonly Action[]): Action | null {
  const decl = waltDeclarationOf(resp.decl);
  if (!decl) return null;
  return acts.find((a) => a.type === 'declare' && sameDecl(a.decl, decl)) ?? null;
}

// ---- conformance ----------------------------------------------------------

/**
 * Every play response carries walt's independently derived trick leader and
 * banked points (teams [0&2, 1&3]). Comparing them against our engine on
 * every decision is the cheap, permanent cross-check that two independent
 * rules engines agree on the replay. Returns a description of the first
 * mismatch, or null when walt and the engine agree.
 */
export function conformanceFailure(obs: Observation, resp: PlayResponse): string | null {
  const expLeader: Seat | null =
    obs.currentTrick.length > 0 ? obs.currentTrick[0]!.seat : obs.leader;
  if (expLeader !== null && resp.leader !== expLeader) {
    return `leader ${resp.leader} != engine ${expLeader}`;
  }
  if (resp.points[0] !== obs.points[0] || resp.points[1] !== obs.points[1]) {
    return `points [${resp.points.join(',')}] != engine [${obs.points.join(',')}]`;
  }
  return null;
}
