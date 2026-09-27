/** Re-simulate a recorded hand action by action, through the real engine. */
import { type Action, type GameState, applyAction, newDealtGame } from '../engine';

export interface HandStep {
  /** The position the actor saw, before acting. */
  readonly state: GameState;
  readonly action: Action;
}

/**
 * Every decision of a hand as (position before, action), or null when the
 * engine disagrees with the record. Same walk as encodeReplay, kept as data.
 * The hand's own config (set by decodeReplay) decides the rules, so every
 * replay preset, Nel-O included, re-simulates under the rules it was played by.
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
