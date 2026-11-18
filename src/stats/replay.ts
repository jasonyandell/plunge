import { applyAction, type Action, type GameState } from '../engine';
import { handStartOf, handSteps } from '../engine/hand-history';

/** Semantic keys also validate untrusted choices against the engine's legal actions. */
export function actionKey(a: Action): string {
  if (a.type === 'play') return `play:${a.domino}`;
  if (a.type === 'declare') return `declare:${a.decl.type}:${a.decl.type === 'pip' ? a.decl.pip : ''}`;
  if (a.type === 'bid') return a.bid.kind === 'pass' ? 'pass'
    : `bid:${a.bid.kind}:${a.bid.value}:${a.bid.kind === 'marks' ? a.bid.special ?? '' : ''}`;
  return a.type;
}
export function replayAt(original: GameState, index: number): GameState {
  return handSteps(original).slice(0, index).reduce((g, step) => applyAction(g, step.action), handStartOf(original));
}
