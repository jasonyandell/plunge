/**
 * The game reducer: pure state machine for a full game of 42 (marks to 7).
 * Illegal actions throw — reneges are impossible by construction
 * (docs/RULES.md §9 option 14).
 */

import {
  ALL_DOMINO_IDS, type DominoId, PIPS, countValue, fromId, pipSum,
} from './dominoes';
import {
  type TrickRules, legalPlays, trickWinnerIndex,
} from './suits';
import { mulberry32, nextRngState, shuffled, toSeed } from './rng';
import { bidsEqual, highBid, isForcedBidTurn, legalBids } from './bidding';
import {
  type Action, type Bid, type CompletedTrick, type Contract, type Declaration,
  type GameConfig, type GameState, type HandResult, type PlayRecord, type Seat,
  type Team,
  CASUAL_CONFIG, contractMarks, nextSeat, otherTeam, partnerOf, teamOf,
} from './types';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function sortHand(hand: readonly DominoId[]): DominoId[] {
  return [...hand].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

function deal(rngState: number): { hands: DominoId[][]; rngState: number } {
  const rand = mulberry32(rngState);
  const ids = shuffled(ALL_DOMINO_IDS, rand);
  const hands = [0, 1, 2, 3].map((i) => sortHand(ids.slice(i * 7, i * 7 + 7)));
  return { hands, rngState: nextRngState(rngState) };
}

function freshHand(state: GameState, shaker: Seat, handNumber: number): GameState {
  const { hands, rngState } = deal(state.rngState);
  return {
    ...state,
    rngState,
    shaker,
    handNumber,
    phase: 'bidding',
    hands,
    dealt: hands.map((h) => [...h]),
    bids: [],
    turn: nextSeat(shaker), // left of the shaker bids first
    declarer: null,
    contract: null,
    declaration: null,
    rules: null,
    sittingOut: null,
    forcedBid: false,
    leader: null,
    currentTrick: [],
    tricks: [],
    points: [0, 0],
    thrownIn: false,
    handResult: null,
  };
}

export function newGame(
  config: GameConfig = CASUAL_CONFIG,
  seed: string | number = 'plunge',
): GameState {
  let rngState = toSeed(seed);
  // First shake: stand-in for "everyone draws, highest pip total shakes first".
  const firstShaker = Math.floor(mulberry32(rngState)() * 4) as Seat;
  rngState = nextRngState(rngState);
  const base: GameState = {
    config,
    rngState,
    marks: [0, 0],
    handNumber: 1,
    shaker: firstShaker,
    phase: 'bidding',
    hands: [[], [], [], []],
    dealt: [[], [], [], []],
    bids: [],
    turn: null,
    declarer: null,
    contract: null,
    declaration: null,
    rules: null,
    sittingOut: null,
    forcedBid: false,
    leader: null,
    currentTrick: [],
    tricks: [],
    points: [0, 0],
    thrownIn: false,
    handResult: null,
    winner: null,
  };
  return freshHand(base, firstShaker, 1);
}

/**
 * A standalone game holding exactly one specified deal — the substrate for
 * portable hand replays (share links). Marks start at 0 and rngState is a
 * fixed constant, so the replayed hand is fully determined by its actions.
 */
export function newDealtGame(
  config: GameConfig,
  dealtHands: readonly (readonly DominoId[])[],
  shaker: Seat,
): GameState {
  if (dealtHands.length !== 4 || dealtHands.some((h) => h.length !== 7)) {
    throw new Error('dealt must be 4 hands of 7 dominoes');
  }
  const seen = new Set<DominoId>();
  for (const h of dealtHands) {
    for (const id of h) {
      fromId(id); // validates the id
      seen.add(id);
    }
  }
  if (seen.size !== 28) throw new Error('dealt must cover all 28 dominoes');
  const hands = dealtHands.map((h) => [...h]);
  return {
    config,
    rngState: 1,
    marks: [0, 0],
    handNumber: 1,
    shaker,
    phase: 'bidding',
    hands,
    dealt: hands.map((h) => [...h]),
    bids: [],
    turn: nextSeat(shaker),
    declarer: null,
    contract: null,
    declaration: null,
    rules: null,
    sittingOut: null,
    forcedBid: false,
    leader: null,
    currentTrick: [],
    tricks: [],
    points: [0, 0],
    thrownIn: false,
    handResult: null,
    winner: null,
  };
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/** Map a declaration to the (κ, π) trick rules; null for Sevens (no suit structure). */
export function buildRules(decl: Declaration, cfg: GameConfig): TrickRules | null {
  switch (decl.type) {
    case 'pip':
      return {
        called: { kind: 'pip', pip: decl.pip },
        powered: true,
        pipSuitDoubles: 'high',
        calledDoublesOrder: 'normal',
      };
    case 'doubles':
      return {
        called: { kind: 'doubles' },
        powered: true,
        pipSuitDoubles: 'high',
        calledDoublesOrder: 'normal',
      };
    case 'no-trump':
      switch (cfg.noTrumpDoubles) {
        case 'high':
          return { called: { kind: 'none' }, powered: false, pipSuitDoubles: 'high', calledDoublesOrder: 'normal' };
        case 'low':
          return { called: { kind: 'none' }, powered: false, pipSuitDoubles: 'low', calledDoublesOrder: 'normal' };
        case 'own-suit':
          return { called: { kind: 'doubles' }, powered: false, pipSuitDoubles: 'high', calledDoublesOrder: 'normal' };
      }
      break;
    case 'nello':
      switch (cfg.nelloDoubles) {
        case 'own-suit':
          return { called: { kind: 'doubles' }, powered: false, pipSuitDoubles: 'high', calledDoublesOrder: 'normal' };
        case 'own-suit-inverted':
          return { called: { kind: 'doubles' }, powered: false, pipSuitDoubles: 'high', calledDoublesOrder: 'inverted' };
        case 'high':
          return { called: { kind: 'none' }, powered: false, pipSuitDoubles: 'high', calledDoublesOrder: 'normal' };
        case 'low':
          return { called: { kind: 'none' }, powered: false, pipSuitDoubles: 'low', calledDoublesOrder: 'normal' };
      }
      break;
    case 'sevens':
      return null;
  }
}

/** Legal declarations for the player on turn in the declaring phase. */
export function legalDeclarations(state: GameState): Declaration[] {
  if (state.phase !== 'declaring' || state.contract === null) return [];
  const cfg = state.config;
  const c = state.contract;
  const out: Declaration[] = PIPS.map((pip) => ({ type: 'pip', pip }));
  out.push({ type: 'doubles' });
  if (c.kind === 'plunge' || c.kind === 'splash') {
    // Partner names trump from their own hand — a trump, not a special contract.
    return out;
  }
  out.push({ type: 'no-trump' });
  if (c.kind === 'marks') {
    if (cfg.nello === 'open' && c.value >= cfg.nelloMinMarks) {
      out.push({ type: 'nello' });
    }
    if (cfg.sevens === 'on' || (cfg.sevens === 'forced-only' && state.forcedBid)) {
      out.push({ type: 'sevens' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Play legality
// ---------------------------------------------------------------------------

/** Sevens: you must play a domino whose pip total is closest to 7. */
function sevensLegal(hand: readonly DominoId[]): DominoId[] {
  const dist = (id: DominoId) => Math.abs(pipSum(fromId(id)) - 7);
  const best = Math.min(...hand.map(dist));
  return hand.filter((id) => dist(id) === best);
}

/** Legal dominoes for the player on turn in the playing phase. */
export function legalDominoes(state: GameState): DominoId[] {
  if (state.phase !== 'playing' || state.turn === null) return [];
  const hand = state.hands[state.turn]!;
  if (state.contract!.kind === 'sevens') return sevensLegal(hand);
  const lead = state.currentTrick[0]?.domino ?? null;
  return legalPlays(hand, lead, state.rules!);
}

/** All legal actions for the current actor — drives the UI, the AIs, and the tests. */
export function legalActions(state: GameState): Action[] {
  switch (state.phase) {
    case 'bidding':
      return legalBids(state).map((bid) => ({ type: 'bid', bid }));
    case 'declaring':
      return legalDeclarations(state).map((decl) => ({ type: 'declare', decl }));
    case 'playing':
      return legalDominoes(state).map((domino) => ({ type: 'play', domino }));
    case 'hand-over':
      return [{ type: 'next-hand' }];
    case 'game-over':
      return [];
  }
}

// ---------------------------------------------------------------------------
// Trick resolution
// ---------------------------------------------------------------------------

/** Sevens trick winner: closest pip total to 7; earliest played breaks ties. */
function sevensWinnerIndex(plays: readonly PlayRecord[]): number {
  let best = 0;
  let bestDist = Math.abs(pipSum(fromId(plays[0]!.domino)) - 7);
  for (let i = 1; i < plays.length; i++) {
    const d = Math.abs(pipSum(fromId(plays[i]!.domino)) - 7);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

function nextActor(seat: Seat, sittingOut: Seat | null): Seat {
  let n = nextSeat(seat);
  if (n === sittingOut) n = nextSeat(n);
  return n;
}

interface Outcome {
  readonly made: boolean;
  readonly marks: number;
  readonly reason: string;
}

/**
 * Has the hand been decided? Called after each completed trick.
 * Per docs/RULES.md §5.6/§6 the hand ends as soon as the result is decided.
 */
function evaluateHand(
  contract: Contract,
  declarer: Seat,
  points: readonly [number, number],
  tricks: readonly CompletedTrick[],
  cfg: GameConfig,
  forcedBid: boolean,
): Outcome | null {
  const declTeam = teamOf(declarer);
  const defTeam = otherTeam(declTeam);
  const declPts = points[declTeam]!;
  const defPts = points[defTeam]!;
  const done = tricks.length === 7;
  const last = tricks[tricks.length - 1]!;

  switch (contract.kind) {
    case 'points': {
      // Made iff declarers reach the bid; set iff defenders reach 43 − bid.
      if (defPts >= 43 - contract.value) {
        return { made: false, marks: 1, reason: `set — defenders took ${defPts} points` };
      }
      if (declPts >= contract.value) {
        const sweepEligible = cfg.forced30SweepBonus && forcedBid && contract.value === 30;
        if (sweepEligible && !done) return null; // play on: the sweep bonus may still be live
        const swept = sweepEligible && tricks.every((t) => teamOf(t.winner) === declTeam);
        return {
          made: true,
          marks: swept ? 2 : 1,
          reason: swept
            ? 'made it with all 7 tricks — forced-bid sweep!'
            : `made it — ${declPts} points`,
        };
      }
      return null;
    }
    case 'marks':
    case 'plunge':
    case 'splash': {
      // All-or-nothing: one defender trick sets it.
      if (teamOf(last.winner) !== declTeam) {
        return { made: false, marks: contract.value, reason: 'set — defenders won a trick' };
      }
      if (done) {
        return { made: true, marks: contract.value, reason: 'made it — all 7 tricks' };
      }
      return null;
    }
    case 'nello': {
      // Declarer must lose every trick; ends the instant they win one.
      if (last.winner === declarer) {
        return { made: false, marks: contract.value, reason: 'set — the bidder won a trick' };
      }
      if (done) {
        return { made: true, marks: contract.value, reason: 'made it — lost every trick' };
      }
      return null;
    }
    case 'sevens': {
      if (last.winner !== declarer) {
        return { made: false, marks: contract.value, reason: 'set — the bidder lost a trick' };
      }
      if (done) {
        return { made: true, marks: contract.value, reason: 'made it — all 7 tricks' };
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

function applyBid(state: GameState, bid: Bid): GameState {
  if (state.phase !== 'bidding' || state.turn === null) {
    throw new Error('not in bidding phase');
  }
  if (!legalBids(state).some((b) => bidsEqual(b, bid))) {
    throw new Error(`illegal bid: ${JSON.stringify(bid)}`);
  }
  const seat = state.turn;
  const forcedBid = state.forcedBid || (isForcedBidTurn(state) && bid.kind !== 'pass');
  const bids = [...state.bids, { seat, bid }];

  if (bids.length < 4) {
    return { ...state, bids, forcedBid, turn: nextSeat(seat) };
  }

  const winner = highBid(bids);
  if (!winner) {
    // All four passed — hand thrown in; shake rotates (reshake config only).
    return { ...state, bids, phase: 'hand-over', turn: null, thrownIn: true };
  }

  const declarer = winner.seat;
  const b = winner.bid;
  if (b.kind === 'pass') throw new Error('unreachable: high bid is a pass');
  const contract: Contract =
    b.kind === 'points'
      ? { kind: 'points', value: b.value }
      : { kind: b.special ?? 'marks', value: b.value };

  if (contract.kind === 'nello') {
    // Forced-bid Nel-O: doubles treatment is fixed by config — no declaration step.
    const declaration: Declaration = { type: 'nello' };
    return {
      ...state, bids, forcedBid, declarer, contract, declaration,
      rules: buildRules(declaration, state.config),
      sittingOut: partnerOf(declarer),
      phase: 'playing',
      leader: declarer,
      turn: declarer,
    };
  }

  const caller =
    contract.kind === 'plunge' || contract.kind === 'splash'
      ? partnerOf(declarer) // partner names trump from their own hand
      : declarer;
  return {
    ...state, bids, forcedBid, declarer, contract,
    phase: 'declaring',
    turn: caller,
  };
}

function applyDeclare(state: GameState, decl: Declaration): GameState {
  if (state.phase !== 'declaring' || state.turn === null || state.declarer === null) {
    throw new Error('not in declaring phase');
  }
  if (!legalDeclarations(state).some((d) => JSON.stringify(d) === JSON.stringify(decl))) {
    throw new Error(`illegal declaration: ${JSON.stringify(decl)}`);
  }
  const cfg = state.config;
  const declarer = state.declarer;
  let contract = state.contract!;
  if (decl.type === 'nello') contract = { kind: 'nello', value: contract.value };
  if (decl.type === 'sevens') contract = { kind: 'sevens', value: contract.value };

  const sittingOut = contract.kind === 'nello' ? partnerOf(declarer) : null;
  const leader: Seat =
    contract.kind === 'plunge' || contract.kind === 'splash'
      ? cfg.plungeFirstLead === 'partner'
        ? partnerOf(declarer)
        : declarer
      : declarer;

  return {
    ...state,
    contract,
    declaration: decl,
    rules: buildRules(decl, cfg),
    sittingOut,
    phase: 'playing',
    leader,
    turn: leader,
    currentTrick: [],
  };
}

function applyPlay(state: GameState, domino: DominoId): GameState {
  if (state.phase !== 'playing' || state.turn === null) {
    throw new Error('not in playing phase');
  }
  if (!legalDominoes(state).includes(domino)) {
    throw new Error(`illegal play: ${domino}`);
  }
  const seat = state.turn;
  const hands = state.hands.map((h, i) =>
    i === seat ? h.filter((id) => id !== domino) : h,
  );
  const currentTrick: PlayRecord[] = [...state.currentTrick, { seat, domino }];
  const trickSize = state.sittingOut === null ? 4 : 3;

  if (currentTrick.length < trickSize) {
    return { ...state, hands, currentTrick, turn: nextActor(seat, state.sittingOut) };
  }

  // Trick complete — resolve it.
  const contract = state.contract!;
  const winnerIdx =
    contract.kind === 'sevens'
      ? sevensWinnerIndex(currentTrick)
      : trickWinnerIndex(currentTrick, state.rules!);
  const trickWinner = currentTrick[winnerIdx]!.seat;
  const trickPoints =
    1 + currentTrick.reduce((acc, p) => acc + countValue(fromId(p.domino)), 0);
  const trick: CompletedTrick = {
    plays: currentTrick,
    winner: trickWinner,
    points: trickPoints,
  };
  const tricks = [...state.tricks, trick];
  const points: [number, number] = [...state.points] as [number, number];
  points[teamOf(trickWinner)] += trickPoints;

  const outcome = evaluateHand(
    contract, state.declarer!, points, tricks, state.config, state.forcedBid,
  );

  if (!outcome) {
    return {
      ...state, hands, tricks, points,
      currentTrick: [],
      leader: trickWinner,
      turn: trickWinner,
    };
  }

  const declTeam = teamOf(state.declarer!);
  const awardedTeam: Team = outcome.made ? declTeam : otherTeam(declTeam);
  const handResult: HandResult = {
    team: awardedTeam,
    marks: outcome.marks,
    made: outcome.made,
    declarer: state.declarer!,
    contract,
    reason: outcome.reason,
  };
  const marks: [number, number] = [...state.marks] as [number, number];
  marks[awardedTeam] += outcome.marks;
  const gameOver = marks[awardedTeam]! >= state.config.targetMarks;

  return {
    ...state, hands, tricks, points, handResult, marks,
    currentTrick: [],
    leader: trickWinner,
    turn: null,
    phase: gameOver ? 'game-over' : 'hand-over',
    winner: gameOver ? awardedTeam : null,
  };
}

function applyNextHand(state: GameState): GameState {
  if (state.phase !== 'hand-over') throw new Error('hand is not over');
  return freshHand(state, nextSeat(state.shaker), state.handNumber + 1);
}

/** Apply one action. Pure: returns a new state, never mutates. Throws on illegal actions. */
export function applyAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'bid': return applyBid(state, action.bid);
    case 'declare': return applyDeclare(state, action.decl);
    case 'play': return applyPlay(state, action.domino);
    case 'next-hand': return applyNextHand(state);
  }
}
