import { applyAction, legalActions, type Action, type GameState, type Seat } from '../engine';
import { handStartOf, handSteps } from '../engine/hand-history';

/** Semantic keys also validate untrusted choices against the engine's legal actions. */
export function actionKey(a: Action): string {
  if (a.type === 'play') return `play:${a.domino}`;
  if (a.type === 'declare') return `declare:${a.decl.type}:${a.decl.type === 'pip' ? a.decl.pip : ''}`;
  if (a.type === 'bid') return a.bid.kind === 'pass' ? 'pass'
    : `bid:${a.bid.kind}:${a.bid.value}:${a.bid.kind === 'marks' ? a.bid.special ?? '' : ''}`;
  return a.type;
}
export interface GhostProgress {
  game: GameState; index: number; matched: number; total: number; done: boolean;
  divergence: { chosen: Action; original: Action } | null;
}
export function replayAt(original: GameState, index: number): GameState {
  return handSteps(original).slice(0, index).reduce((g, step) => applyAction(g, step.action), handStartOf(original));
}
/** Play recorded opponents and forced moves; ask only for this seat's real decisions. */
export function ghostProgress(original: GameState, seat: Seat, choices: readonly Action[]): GhostProgress {
  if (![0, 1, 2, 3].includes(seat) || choices.length > 50) throw new Error('Invalid replay attempt.');
  const steps = handSteps(original);
  let sim = handStartOf(original), total = 0;
  for (const step of steps) {
    if (step.seat === seat && legalActions(sim).length > 1) total++;
    sim = applyAction(sim, step.action);
  }
  let game = handStartOf(original), matched = 0, used = 0;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!, legal = legalActions(game);
    if (step.seat === seat && legal.length > 1) {
      if (used === choices.length) return { game, index, matched, total, done: false, divergence: null };
      const chosen = choices[used++]!;
      let canonical: Action | undefined;
      try { canonical = legal.find(a => actionKey(a) === actionKey(chosen)); } catch { /* Invalid input. */ }
      if (!canonical) throw new Error('That choice is not legal here.');
      if (actionKey(canonical) !== actionKey(step.action)) {
        if (used !== choices.length) throw new Error('Choices continue after the replay diverged.');
        return { game, index, matched, total, done: true, divergence: { chosen: canonical, original: step.action } };
      }
      matched++;
    }
    game = applyAction(game, step.action);
  }
  if (used !== choices.length) throw new Error('Choices continue after the hand ended.');
  return { game, index: steps.length, matched, total, done: true, divergence: null };
}
export interface ReplayAttempt { id: string; choices: Action[]; matched: number; total: number; done: boolean }
export function replayScores(attempts: readonly ReplayAttempt[]) {
  return { first: attempts[0] ?? null, best: attempts.length ? Math.max(...attempts.map(a => a.matched)) : null,
    retries: Math.max(0, attempts.length - 1) };
}
