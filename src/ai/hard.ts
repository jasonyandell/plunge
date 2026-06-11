/**
 * Hard: medium's evaluation refined by Monte Carlo determinization.
 *
 * For declarations and plays it samples plausible hidden-hand worlds that are
 * consistent with the Observation — (a) only unseen dominoes, (b) void
 * inferences from failures to follow, (c) the known remaining hand sizes —
 * plays every candidate action out in each world with the medium policy at
 * ALL four seats, scores the resulting hand in marks (points as tiebreak),
 * and picks the action with the best total.
 *
 * Determinism: the world count is a pure function of the candidate count, all
 * randomness comes from `rand`, and the wall-clock is consulted only by a
 * safety valve (~380 ms) that never fires at the tuned world counts on a
 * modern machine.
 */

import {
  type Action,
  type DominoId,
  type GameState,
  type LedSuit,
  type Seat,
  type Team,
  applyAction,
  follows,
  fromId,
  legalActions,
  shuffled,
  teamOf,
} from '../engine';
import { type Observation, observe } from './observation';
import { mediumAction, mediumBid } from './medium';

const SAFETY_DEADLINE_MS = 380;

/** Determinizations per decision — fewer when there are many candidates. */
function worldCount(nActs: number): number {
  if (nActs <= 2) return 48;
  if (nActs <= 4) return 32;
  return 24;
}

function allowedFor(obs: Observation, s: Seat, id: DominoId): boolean {
  const rules = obs.rules;
  if (!rules) return true;
  const v = obs.voids[s]!;
  const d = fromId(id);
  for (let led = 0; led < 8; led++) {
    if (v[led] && follows(d, led as LedSuit, rules)) return false;
  }
  return true;
}

/**
 * Sample one world: hidden hands drawn from `obs.unseen`, respecting hand
 * sizes and void constraints (rejection sampling with a constraint-free
 * fallback for the rare unsatisfiable shuffle ordering).
 */
export function sampleWorld(obs: Observation, rand: () => number): DominoId[][] {
  const me = obs.seat;
  const hidden = ([0, 1, 2, 3] as Seat[]).filter((s) => s !== me);
  const constraintLoad = (s: Seat) => obs.voids[s]!.filter(Boolean).length;
  hidden.sort((a, b) => constraintLoad(b) - constraintLoad(a)); // stable sort

  for (let attempt = 0; attempt < 40; attempt++) {
    const pool = shuffled(obs.unseen, rand);
    const taken = new Array<boolean>(pool.length).fill(false);
    const hands: DominoId[][] = [[], [], [], []];
    hands[me] = [...obs.hand];
    let ok = true;
    for (const s of hidden) {
      const need = obs.handSizes[s]!;
      const h: DominoId[] = [];
      for (let i = 0; i < pool.length && h.length < need; i++) {
        if (taken[i]) continue;
        if (allowedFor(obs, s, pool[i]!)) {
          taken[i] = true;
          h.push(pool[i]!);
        }
      }
      if (h.length < need) {
        ok = false;
        break;
      }
      hands[s] = h;
    }
    if (ok) return hands;
  }

  // Fallback: constraints unsatisfiable by greedy assignment — deal plainly.
  const pool = shuffled(obs.unseen, rand);
  const hands: DominoId[][] = [[], [], [], []];
  hands[me] = [...obs.hand];
  let idx = 0;
  for (const s of hidden) {
    hands[s] = pool.slice(idx, idx + obs.handSizes[s]!);
    idx += obs.handSizes[s]!;
  }
  return hands;
}

/** Reassemble a full GameState for one sampled world — from the Observation
 *  only, so the real hidden hands can never leak in. */
function buildState(obs: Observation, hands: DominoId[][]): GameState {
  return {
    config: obs.config,
    rngState: 0x9e3779b9, // irrelevant: the deal already happened
    marks: obs.marks,
    handNumber: obs.handNumber,
    shaker: obs.shaker,
    phase: obs.phase,
    hands,
    dealt: hands,
    bids: obs.bids,
    turn: obs.turn,
    declarer: obs.declarer,
    contract: obs.contract,
    declaration: obs.declaration,
    rules: obs.rules,
    sittingOut: obs.sittingOut,
    forcedBid: obs.forcedBid,
    leader: obs.leader,
    currentTrick: obs.currentTrick,
    tricks: obs.tricks,
    points: obs.points,
    thrownIn: false,
    handResult: null,
    winner: null,
  };
}

/** Play the hand out with the medium policy at every seat. */
function rollout(start: GameState, rand: () => number): GameState {
  let st = start;
  let guard = 64;
  while ((st.phase === 'playing' || st.phase === 'declaring') && guard-- > 0) {
    const turn = st.turn as Seat;
    const acts = legalActions(st);
    const a = acts.length === 1 ? acts[0]! : mediumAction(observe(st, turn), acts, rand);
    st = applyAction(st, a);
  }
  return st;
}

function scoreFor(st: GameState, myTeam: Team): number {
  const other = (1 - myTeam) as Team;
  const pointsDiff = st.points[myTeam]! - st.points[other]!;
  const hr = st.handResult;
  if (!hr) return pointsDiff;
  return (hr.team === myTeam ? hr.marks : -hr.marks) * 1000 + pointsDiff;
}

function mcBest(obs: Observation, acts: readonly Action[], rand: () => number): Action {
  const started = Date.now();
  const myTeam = teamOf(obs.seat);
  const n = acts.length;
  const totals = new Array<number>(n).fill(0);
  const worlds = worldCount(n);
  for (let w = 0; w < worlds; w++) {
    const hands = sampleWorld(obs, rand);
    for (let i = 0; i < n; i++) {
      let st = buildState(obs, hands);
      st = applyAction(st, acts[i]!);
      st = rollout(st, rand);
      totals[i]! += scoreFor(st, myTeam);
    }
    // Safety valve only — never reached at these world counts in practice.
    if (Date.now() - started > SAFETY_DEADLINE_MS) break;
  }
  let best = 0;
  for (let i = 1; i < n; i++) {
    if (totals[i]! > totals[best]!) best = i;
  }
  return acts[best]!;
}

export function hardAction(
  obs: Observation,
  acts: readonly Action[],
  rand: () => number,
): Action {
  if (acts.length === 1) return acts[0]!;
  switch (obs.phase) {
    case 'bidding':
      return mediumBid(obs, acts); // honest heuristic ladder
    case 'declaring':
    case 'playing':
      return mcBest(obs, acts, rand);
    default:
      return acts[0]!;
  }
}
