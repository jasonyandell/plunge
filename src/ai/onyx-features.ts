/**
 * TS port of the Gus student's featurization — the EXACT contract the Python
 * tokenizer defines. Mirrors:
 *   - gus/model/tokenize.py  `tokenize_decision`      -> tokens[33,5], attn[33]
 *   - gus/model/voids.py     `voids_feature_vector`   -> voids[24]
 *   - gus/model/auction.py   `auction_feature_vector` -> bids[28]
 *
 * Parity with Python is gated by tests/onyx-parity.test.ts against the
 * golden.json emitted by scratch/champion-run/export_onyx.py. If you change
 * anything here, that test must still pass byte-for-byte — do not loosen it.
 *
 * Everything is keyed on the Python domino id 0..27, which is the index of a
 * domino in `ALL_DOMINO_IDS` (proven identical ordering: both are
 * `[(high, low) for high in 0..6 for low in 0..high]`). See `idToDomId` /
 * `domIdToId`.
 */

import { ALL_DOMINO_IDS, type DominoId } from '../engine';

// ---- domino id <-> Python domino-id (0..27) -------------------------------

const ID_TO_DOMID = new Map<DominoId, number>(
  ALL_DOMINO_IDS.map((id, i) => [id, i]),
);

/** plunge DominoId string -> Python domino id 0..27. */
export function idToDomId(id: DominoId): number {
  const d = ID_TO_DOMID.get(id);
  if (d === undefined) throw new Error(`unknown domino id: ${id}`);
  return d;
}

/** Python domino id 0..27 -> plunge DominoId string. */
export function domIdToId(d: number): DominoId {
  const id = ALL_DOMINO_IDS[d];
  if (id === undefined) throw new Error(`domino id out of range: ${d}`);
  return id;
}

/** (high, low) pips of Python domino id d, matching gus.model.voids.domino_pips. */
export function domPips(d: number): [number, number] {
  let idx = 0;
  for (let a = 0; a < 7; a++) {
    for (let b = 0; b <= a; b++) {
      if (idx === d) return [a, b];
      idx++;
    }
  }
  throw new Error(`invalid domino id: ${d}`);
}

// ---- token-layout constants (gus/model/tokenize.py) -----------------------

const N_DOMINOES = 28;
const PAD_TOKEN = 28;
const CLS_TOKEN = 29;
const DECL_OFFSET = 30;

const SEQ_LEN = 1 + 1 + 7 + 6 * 4; // 33

const TYPE_CLS = 0;
const TYPE_DECL = 1;
const TYPE_MINE = 2;
const TYPE_PLAY = 3;

const TRICK_NA = 7;
const POS_NA = 4;
const PLAYER_REL_NA = 4;

/** A play in chronological order: absolute seat 0..3 + Python domino id 0..27. */
export interface DomPlay {
  readonly seat: number;
  readonly domId: number;
}

/**
 * The canonical input to every featurizer — exactly the quantities
 * champion/belief.py reconstructs from a ZebGameState:
 *   hands:   [4][?] initial-hand domino ids per absolute seat (slot order)
 *   declId:  0..9 (EVAL_DECLS for the champion: 0..7, 9)
 *   plays:   chronological prior plays (seat, domId)
 *   cp:      current player (absolute seat 0..3)
 */
export interface FeatureInput {
  readonly hands: readonly (readonly number[])[];
  readonly declId: number;
  readonly plays: readonly DomPlay[];
  readonly cp: number;
}

export interface OnyxTensors {
  /** [33*5] int32, row-major (position-major): tokens[pos*5 + ch]. */
  readonly tokens: Int32Array;
  /** [33] bool. */
  readonly attn: Uint8Array;
  /** [24] float. */
  readonly voids: Float32Array;
  /** [28] float. */
  readonly bids: Float32Array;
}

// ---------------------------------------------------------------------------
// Tokenizer — gus/model/tokenize.py:tokenize_decision
// ---------------------------------------------------------------------------

export function tokenizeDecision(input: FeatureInput): {
  tokens: Int32Array;
  attn: Uint8Array;
} {
  const { hands, declId, plays, cp } = input;

  // prior plays are the full `plays` list (decisions[:d_idx]); the current
  // decision (cp, slot=0) is appended in Python but contributes no prior play.
  const priorPlays = plays;

  // What cp has already played (for MINE-slot computation).
  const playedByMe = new Set<number>();
  for (const p of priorPlays) if (p.seat === cp) playedByMe.add(p.domId);

  const myInitial = hands[cp]!.filter((d) => d >= 0);
  const myCurrent = myInitial.filter((d) => !playedByMe.has(d));

  const tokens = new Int32Array(SEQ_LEN * 5);
  const attn = new Uint8Array(SEQ_LEN);
  let pos = 0;
  const put = (tok: number, ty: number, tr: number, po: number, pr: number) => {
    const o = pos * 5;
    tokens[o] = tok;
    tokens[o + 1] = ty;
    tokens[o + 2] = tr;
    tokens[o + 3] = po;
    tokens[o + 4] = pr;
    attn[pos] = tok !== PAD_TOKEN ? 1 : 0;
    pos++;
  };

  // pos 0: CLS
  put(CLS_TOKEN, TYPE_CLS, TRICK_NA, POS_NA, PLAYER_REL_NA);
  // pos 1: DECL
  put(DECL_OFFSET + declId, TYPE_DECL, TRICK_NA, POS_NA, PLAYER_REL_NA);
  // pos 2..8: MINE (player_rel = 0 = me; pad the rest, still type MINE/rel 0)
  for (let i = 0; i < 7; i++) {
    if (i < myCurrent.length) put(myCurrent[i]!, TYPE_MINE, TRICK_NA, POS_NA, 0);
    else put(PAD_TOKEN, TYPE_MINE, TRICK_NA, POS_NA, 0);
  }
  // pos 9..32: PLAY (6 tricks x 4)
  for (let t = 0; t < 6; t++) {
    for (let i = 0; i < 4; i++) {
      const flat = t * 4 + i;
      if (flat < priorPlays.length) {
        const pl = priorPlays[flat]!;
        const rel = ((pl.seat - cp) % 4 + 4) % 4;
        put(pl.domId, TYPE_PLAY, t, i, rel);
      } else {
        put(PAD_TOKEN, TYPE_PLAY, TRICK_NA, POS_NA, PLAYER_REL_NA);
      }
    }
  }

  return { tokens, attn };
}

// ---------------------------------------------------------------------------
// Voids — gus/model/voids.py:voids_feature_vector
// ---------------------------------------------------------------------------

const N_SUITS = 8;

function isTrump(d: number, declId: number): boolean {
  const [a, b] = domPips(d);
  if (declId === 7) return a === b; // doubles trump
  if (declId >= 0 && declId <= 6) return a === declId || b === declId;
  return false; // no-trump (9) etc.
}

function ledSuit(d: number, declId: number): number {
  const [a, b] = domPips(d);
  if (isTrump(d, declId)) return declId;
  return Math.max(a, b);
}

function canFollow(d: number, led: number, declId: number): boolean {
  if (led === declId) return isTrump(d, declId);
  const [a, b] = domPips(d);
  if (led === 7) return false;
  if ((a === led || b === led) && !isTrump(d, declId)) return true;
  return false;
}

export function voidsFeatureVector(input: FeatureInput): Float32Array {
  const { plays, declId, cp } = input;
  // voids_abs[seat][suit]
  const voidsAbs: boolean[][] = [0, 1, 2, 3].map(() =>
    new Array<boolean>(N_SUITS).fill(false),
  );
  for (let tStart = 0; tStart < plays.length; tStart += 4) {
    const trick = plays.slice(tStart, tStart + 4);
    if (trick.length === 0) break;
    const led = ledSuit(trick[0]!.domId, declId);
    for (let i = 1; i < trick.length; i++) {
      const p = trick[i]!;
      if (!canFollow(p.domId, led, declId)) voidsAbs[p.seat]![led] = true;
    }
  }
  // project to relative seats (1=left,2=partner,3=right), flatten [3*8]=24
  const out = new Float32Array(24);
  for (let rel = 1; rel <= 3; rel++) {
    const absP = (cp + rel) % 4;
    for (let s = 0; s < N_SUITS; s++) {
      out[(rel - 1) * N_SUITS + s] = voidsAbs[absP]![s] ? 1 : 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auction — gus/model/auction.py:auction_feature_vector
// ---------------------------------------------------------------------------

const N_AUCTION_FEATURES = 28;
const N_DECLS = 10;
const BID_LO = 30;
const BID_HI = 42;
const MARKS_BID = 84;

function bidNorm(bid: number): number {
  if (bid < BID_LO) return 0;
  return Math.min(1, (bid - BID_LO) / (BID_HI - BID_LO));
}

/**
 * Auction feature, current-player POV. `bids` per ABSOLUTE seat (raw values,
 * 0 = pass), or null for "no auction recorded" (all-zero feature). `bidder`
 * = winning seat (or -1/null), `bidValue` = winning bid value.
 */
export function auctionFeatureVector(
  bids: readonly number[] | null,
  bidder: number | null,
  bidValue: number | null,
  declId: number,
  cp: number,
): Float32Array {
  const feat = new Float32Array(N_AUCTION_FEATURES);
  if (bids === null) return feat;

  for (let r = 0; r < 4; r++) {
    const absSeat = (cp + r) % 4;
    const bid = absSeat < bids.length ? bids[absSeat]! : 0;
    feat[4 * r + 0] = bidNorm(bid);
    feat[4 * r + 1] = bid <= 0 ? 1 : 0;
    feat[4 * r + 2] = bid >= BID_LO ? 1 : 0;
    feat[4 * r + 3] = bidder !== null && bidder >= 0 && absSeat === bidder ? 1 : 0;
  }
  feat[16] = bidNorm(bidValue ?? 0);
  feat[17] = bidValue !== null && bidValue >= MARKS_BID ? 1 : 0;
  if (declId >= 0 && declId < N_DECLS) feat[18 + declId] = 1;
  return feat;
}

// ---------------------------------------------------------------------------
// Convenience: all four tensors at once.
// ---------------------------------------------------------------------------

export function buildTensors(
  input: FeatureInput,
  bids: readonly number[] | null,
  bidder: number | null,
  bidValue: number | null,
): OnyxTensors {
  const { tokens, attn } = tokenizeDecision(input);
  const voids = voidsFeatureVector(input);
  const auc = auctionFeatureVector(bids, bidder, bidValue, input.declId, input.cp);
  return { tokens, attn, voids, bids: auc };
}
