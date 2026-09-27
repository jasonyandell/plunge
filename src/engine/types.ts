/**
 * Game state, actions, and the configuration matrix from docs/RULES.md §9.
 */

import type { DominoId, Pip } from './dominoes';
import type { TrickRules } from './suits';

export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export function partnerOf(s: Seat): Seat {
  return ((s + 2) % 4) as Seat;
}

export function teamOf(s: Seat): Team {
  return (s % 2) as Team;
}

/** Play proceeds clockwise = ascending seat order. */
export function nextSeat(s: Seat): Seat {
  return ((s + 1) % 4) as Seat;
}

export function otherTeam(t: Team): Team {
  return (1 - t) as Team;
}

// ---------------------------------------------------------------------------
// Configuration (docs/RULES.md §9)
// ---------------------------------------------------------------------------

export interface GameConfig {
  /** Option 1 (marks mode): game ends at this many marks. */
  readonly targetMarks: number;
  /** Option 2: what happens when all four players pass. */
  readonly allPass: 'reshake' | 'force-30' | 'force-30-or-nello';
  /** Option 3 */
  readonly nello: 'off' | 'open' | 'forced-only';
  /** Option 4 */
  readonly nelloMinMarks: 1 | 2;
  /** Option 5 */
  readonly nelloDoubles: 'own-suit' | 'high' | 'low' | 'own-suit-inverted';
  /** Option 6 */
  readonly plunge: boolean;
  /** Option 7: 4 = jump privilege; 3 or 2 = plain ladder bid at that height. */
  readonly plungeMarks: 2 | 3 | 4;
  /** Option 8 */
  readonly plungeFirstLead: 'partner' | 'declarer';
  /** Option 9 */
  readonly splash: boolean;
  /** Option 10 */
  readonly splashMarks: 2 | 3 | '2or3';
  /** Option 11 */
  readonly sevens: 'off' | 'on' | 'forced-only';
  /** Option 12: follow-me (no-trump) doubles treatment. */
  readonly noTrumpDoubles: 'high' | 'low' | 'own-suit';
  /** Option 13: forced 30 bid that sweeps all 7 tricks scores 2 marks. */
  readonly forced30SweepBonus: boolean;
  // Option 14 (renege handling) is always engine-prevented: illegal plays are impossible.
}

/** The common Texas house game — the project default ("casual family preset"). */
export const CASUAL_CONFIG: GameConfig = {
  targetMarks: 7,
  allPass: 'reshake',
  nello: 'open',
  nelloMinMarks: 1,
  nelloDoubles: 'own-suit',
  plunge: true,
  plungeMarks: 4,
  plungeFirstLead: 'partner',
  splash: true,
  splashMarks: '2or3',
  sevens: 'off',
  noTrumpDoubles: 'high',
  forced30SweepBonus: false,
};

/** N42PA straight 42. */
export const TOURNAMENT_CONFIG: GameConfig = {
  ...CASUAL_CONFIG,
  nello: 'off',
  plunge: false,
  splash: false,
  sevens: 'off',
  noTrumpDoubles: 'high',
  allPass: 'reshake',
};

/** Plunge's straight house game: the last bidder must take at least 30. */
export const LEGACY_PLUNGE_CONFIG: GameConfig = { ...TOURNAMENT_CONFIG, allPass: 'force-30' };
/** Family table: open human Nel-O, with the existing forced minimum bid. */
export const PLUNGE_CONFIG: GameConfig = { ...LEGACY_PLUNGE_CONFIG, nello: 'open' };

// ---------------------------------------------------------------------------
// Bids and contracts
// ---------------------------------------------------------------------------

/**
 * A bid. Marks value 1 = "42", 2 = "84", etc. `special` tags contracts that
 * must be known (and validated) at bid time: Plunge/Splash (doubles
 * requirement, RULES §10 invariant 10) and forced-bid Nel-O.
 */
export type Bid =
  | { readonly kind: 'pass' }
  | { readonly kind: 'points'; readonly value: number } // 30..41
  | {
      readonly kind: 'marks';
      readonly value: number; // ≥ 1
      readonly special?: 'plunge' | 'splash' | 'nello';
    };

export const PASS: Bid = { kind: 'pass' };

export type ContractKind = 'points' | 'marks' | 'nello' | 'plunge' | 'splash' | 'sevens';

/**
 * The contract in force for a hand. For 'points', value is the bid (30–41) and
 * the stake is 1 mark; for everything else, value is the marks at stake.
 */
export interface Contract {
  readonly kind: ContractKind;
  readonly value: number;
}

export function contractMarks(c: Contract): number {
  return c.kind === 'points' ? 1 : c.value;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Declaration =
  | { readonly type: 'pip'; readonly pip: Pip }
  | { readonly type: 'doubles' } // doubles as their own trump suit
  | { readonly type: 'no-trump' } // follow me
  | { readonly type: 'nello' } // open Nel-O on a marks bid
  | { readonly type: 'sevens' };

export type Action =
  | { readonly type: 'bid'; readonly bid: Bid }
  | { readonly type: 'declare'; readonly decl: Declaration }
  | { readonly type: 'play'; readonly domino: DominoId }
  | { readonly type: 'next-hand' };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SeatBid {
  readonly seat: Seat;
  readonly bid: Bid;
}

export interface PlayRecord {
  readonly seat: Seat;
  readonly domino: DominoId;
}

export interface CompletedTrick {
  readonly plays: readonly PlayRecord[];
  readonly winner: Seat;
  readonly points: number; // 1 trick point + count captured
}

export interface HandResult {
  /** Team awarded the marks. Exactly one team gets exactly the contract's value. */
  readonly team: Team;
  readonly marks: number;
  /** True if the declaring team made its contract. */
  readonly made: boolean;
  readonly declarer: Seat;
  readonly contract: Contract;
  /** Short human-readable explanation, e.g. "set — defenders took 13 points". */
  readonly reason: string;
}

export type Phase = 'bidding' | 'declaring' | 'playing' | 'hand-over' | 'game-over';

export interface GameState {
  readonly config: GameConfig;
  /** PRNG state; advances with each deal. Same seed ⇒ same game. */
  readonly rngState: number;
  readonly marks: readonly [number, number];
  readonly handNumber: number;
  readonly shaker: Seat;
  readonly phase: Phase;

  // ----- current hand -----
  /** Remaining (unplayed) dominoes by seat. */
  readonly hands: readonly (readonly DominoId[])[];
  /** The original 7-domino deal by seat (for recap/verification). */
  readonly dealt: readonly (readonly DominoId[])[];
  readonly bids: readonly SeatBid[];
  /** Whose action is next (bid, declare, or play); null when no actor. */
  readonly turn: Seat | null;
  readonly declarer: Seat | null;
  readonly contract: Contract | null;
  readonly declaration: Declaration | null;
  /** Trick mechanics in force; null before declaration and for Sevens. */
  readonly rules: TrickRules | null;
  /** Nel-O: the declarer's partner sits out. */
  readonly sittingOut: Seat | null;
  /** True when the bid was forced on the shaker after three passes. */
  readonly forcedBid: boolean;
  readonly leader: Seat | null;
  readonly currentTrick: readonly PlayRecord[];
  readonly tricks: readonly CompletedTrick[];
  /** Points (tricks + count) captured this hand, by team. */
  readonly points: readonly [number, number];
  /** Set when the hand was thrown in after four passes. */
  readonly thrownIn: boolean;
  readonly handResult: HandResult | null;
  /** Winning team once phase is 'game-over'. */
  readonly winner: Team | null;
}
