/**
 * Replay a recorded hand decision by decision, and branch from any decision
 * with other legal moves. Everything runs through the real engine, so a
 * branch can never contain an illegal move.
 */
import {
  type Action, type GameState, type Seat, applyAction, bidsEqual, legalActions, newDealtGame,
} from '../engine';

export interface HandStep {
  /** The position the actor saw, before acting. */
  readonly state: GameState;
  readonly action: Action;
}

/**
 * Every decision of a hand as (position before, action), or null when the
 * engine disagrees with the record. Recovered from the in-flight records
 * branch (src/stats/replay.ts at f2b8fb0); same walk as encodeReplay.
 */
export function handSteps(g: GameState): HandStep[] | null {
  try {
    let sim = newDealtGame(g.config, g.dealt, g.shaker);
    const steps: HandStep[] = [];
    const push = (action: Action) => { steps.push({ state: sim, action }); sim = applyAction(sim, action); };
    for (const sb of g.bids) push({ type: 'bid', bid: sb.bid });
    if (g.declaration && sim.phase === 'declaring') push({ type: 'declare', decl: g.declaration });
    for (const t of g.tricks) for (const p of t.plays) push({ type: 'play', domino: p.domino });
    for (const p of g.currentTrick) push({ type: 'play', domino: p.domino });
    if (sim.points[0] !== g.points[0] || sim.points[1] !== g.points[1]
      || JSON.stringify(sim.tricks) !== JSON.stringify(g.tricks)) return null;
    return steps;
  } catch {
    return null;
  }
}

/** The position after the last recorded action. */
export function finalState(steps: readonly HandStep[], fallback: GameState): GameState {
  const last = steps[steps.length - 1];
  return last ? applyAction(last.state, last.action) : fallback;
}

export function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'play' && b.type === 'play') return a.domino === b.domino;
  if (a.type === 'bid' && b.type === 'bid') return bidsEqual(a.bid, b.bid);
  if (a.type === 'declare' && b.type === 'declare') return JSON.stringify(a.decl) === JSON.stringify(b.decl);
  return true;
}

/**
 * Where the reviewer is looking: `at` recorded decisions have happened; then
 * `branch` moves (possibly none) replace the recorded continuation.
 */
export interface Cursor {
  readonly at: number;
  readonly branch: readonly Action[];
}

export const START: Cursor = { at: 0, branch: [] };

/** The position at a cursor, or null when the cursor no longer applies. */
export function positionAt(steps: readonly HandStep[], end: GameState, c: Cursor): GameState | null {
  if (!Number.isInteger(c.at) || c.at < 0 || c.at > steps.length) return null;
  let g = c.at < steps.length ? steps[c.at]!.state : end;
  try {
    for (const action of c.branch) {
      if (!legalActions(g).some(a => sameAction(a, action))) return null;
      g = applyAction(g, action);
    }
  } catch { return null; }
  return g;
}

/** Play one more move from the cursor. Illegal moves are refused, not applied. */
export function play(steps: readonly HandStep[], end: GameState, c: Cursor, action: Action): Cursor | null {
  const g = positionAt(steps, end, c);
  if (!g || action.type === 'next-hand' || !legalActions(g).some(a => sameAction(a, action))) return null;
  // Choosing the recorded move from the recorded line just advances replay.
  if (c.branch.length === 0 && c.at < steps.length && sameAction(steps[c.at]!.action, action)) return { at: c.at + 1, branch: [] };
  return { at: c.at, branch: [...c.branch, action] };
}

/** Undo the last branch move, or step the replay back one decision. */
export function back(c: Cursor): Cursor {
  if (c.branch.length) return { at: c.at, branch: c.branch.slice(0, -1) };
  return { at: Math.max(0, c.at - 1), branch: [] };
}

/** Step the recorded replay forward (only on the recorded line). */
export function forward(steps: readonly HandStep[], c: Cursor): Cursor {
  if (c.branch.length) return c;
  return { at: Math.min(steps.length, c.at + 1), branch: [] };
}

/** Drop the branch and return to the recorded line at the divergence point. */
export function resetBranch(c: Cursor): Cursor {
  return { at: c.at, branch: [] };
}

/** Who acts at a cursor (null once the hand is over). */
export function actorAt(g: GameState): Seat | null {
  return g.phase === 'bidding' || g.phase === 'declaring' || g.phase === 'playing' ? g.turn : null;
}

// ---------------------------------------------------------------------------
// Compact action tokens for the reload-safe location hash.

export function actionToken(a: Action): string {
  switch (a.type) {
    case 'play': return `p${a.domino}`;
    case 'bid': return a.bid.kind === 'pass' ? 'bP' : a.bid.kind === 'points' ? `b${a.bid.value}`
      : `bM${a.bid.value}${a.bid.special ? a.bid.special[0] : ''}`;
    case 'declare': return a.decl.type === 'pip' ? `d${a.decl.pip}` : `d${a.decl.type}`;
    case 'next-hand': return 'n';
  }
}

export function tokenAction(t: string): Action | null {
  if (/^p[0-6]{2}$/.test(t)) return { type: 'play', domino: t.slice(1) };
  if (t === 'bP') return { type: 'bid', bid: { kind: 'pass' } };
  if (/^b\d{2}$/.test(t)) return { type: 'bid', bid: { kind: 'points', value: Number(t.slice(1)) } };
  const m = /^bM(\d+)([psn]?)$/.exec(t);
  if (m) {
    const special = ({ p: 'plunge', s: 'splash', n: 'nello' } as const)[m[2] as 'p' | 's' | 'n'];
    return { type: 'bid', bid: special ? { kind: 'marks', value: Number(m[1]), special } : { kind: 'marks', value: Number(m[1]) } };
  }
  if (/^d[0-6]$/.test(t)) return { type: 'declare', decl: { type: 'pip', pip: Number(t[1]) as 0 } };
  const d = /^d(doubles|no-trump|nello|sevens)$/.exec(t);
  if (d) return { type: 'declare', decl: { type: d[1] as 'doubles' } };
  return null;
}

export interface ReviewLocation {
  readonly hand: string | null;
  readonly cursor: Cursor;
  /** QA switch, e.g. 'storage-failure' to simulate unreadable storage. */
  readonly qa?: string;
}

/** `#review` lists hands; `#review=<key>&at=<n>&b=<tokens>` opens one. */
export function parseReviewHash(hash: string): ReviewLocation | null {
  const m = /^#review(?:=([^&]+))?(&.*)?$/.exec(hash);
  if (!m) return null;
  const params = new URLSearchParams((m[2] ?? '').slice(1));
  const qa = params.get('qa') ?? undefined;
  const tokens = (params.get('b') ?? '').split(',').filter(Boolean).map(tokenAction);
  const at = Number(params.get('at') ?? 0);
  let hand: string | null = null;
  try { hand = m[1] ? decodeURIComponent(m[1]) : null; } catch { return null; }
  return { hand, cursor: { at: Number.isInteger(at) && at >= 0 ? at : 0, branch: tokens.every(Boolean) ? tokens as Action[] : [] },
    ...(qa ? { qa } : {}) };
}

export function reviewHash(loc: ReviewLocation): string {
  const qa = loc.qa ? `&qa=${encodeURIComponent(loc.qa)}` : '';
  if (loc.hand === null) return `#review${qa}`;
  const b = loc.cursor.branch.map(actionToken).join(',');
  return `#review=${encodeURIComponent(loc.hand)}&at=${loc.cursor.at}${b ? `&b=${b}` : ''}${qa}`;
}
