import { applyAction, legalActions, mulberry32, shuffled, toSeed, type Action, type GameState, type Seat } from '../engine';
import { handStartOf, handSteps } from '../engine/hand-history';
import { actionKey } from './replay';

export type PracticeKind = 'same' | 'similar';
export interface PracticeSave {
  id: string; created: string; source: string; seat: Seat; kind: PracticeKind; seed: string; actions: Action[];
}
export interface PracticeRun extends PracticeSave {
  game: GameState;
  /** First action that belongs to the new path. Null while following the source exactly. */
  branchAt: number | null;
}
export const handFinished = (game: GameState) => game.phase === 'hand-over' || game.phase === 'game-over';

/** Keep the selected seven tiles, rules, shaker and pre-hand score. Redeal only the other 21. */
export function similarDeal(original: GameState, seat: Seat, seed: string): GameState {
  const start = handStartOf(original);
  const others = ([0, 1, 2, 3] as Seat[]).filter(s => s !== seat);
  const tiles = shuffled(others.flatMap(s => start.dealt[s]!), mulberry32(toSeed(seed)));
  const hands = start.dealt.map(h => [...h]);
  others.forEach((s, i) => { hands[s] = tiles.slice(i * 7, i * 7 + 7).sort().reverse(); });
  // A similar deal must actually change the other holdings, even for an unlucky seed.
  if (others.every(s => [...hands[s]!].sort().join() === [...start.dealt[s]!].sort().join())) {
    const a = hands[others[0]!]!, b = hands[others[1]!]!;
    [a[0], b[0]] = [b[0]!, a[0]!]; a.sort().reverse(); b.sort().reverse();
  }
  return { ...start, hands, dealt: hands.map(h => [...h]), rngState: toSeed(seed) };
}
export function startPractice(original: GameState, save: Omit<PracticeSave, 'actions'>): PracticeRun {
  if (![0,1,2,3].includes(save.seat) || !['same','similar'].includes(save.kind)) throw new Error('Choose a hand and seat.');
  return { ...save, actions: [], game: save.kind === 'same' ? handStartOf(original) : similarDeal(original, save.seat, save.seed),
    branchAt: save.kind === 'similar' ? 0 : null };
}
export function recordedAction(original: GameState, run: PracticeRun): Action | null {
  return run.branchAt === null ? handSteps(original)[run.actions.length]?.action ?? null : null;
}
/** Validate every move. Once a path branches, it never starts copying the old continuation again. */
export function playPractice(original: GameState, run: PracticeRun, action: Action): PracticeRun {
  if (handFinished(run.game) || action.type === 'next-hand') throw new Error('This practice hand is finished.');
  const canonical = legalActions(run.game).find(a => actionKey(a) === actionKey(action));
  if (!canonical) throw new Error('That move is not legal here.');
  const recorded = recordedAction(original, run);
  const branchAt = run.branchAt ?? (recorded && actionKey(recorded) === actionKey(canonical) ? null : run.actions.length);
  return { ...run, actions: [...run.actions, canonical], game: applyAction(run.game, canonical), branchAt };
}
/** Late AI responses and double taps cannot land in a restarted or already advanced hand. */
export function acceptPracticeMove(original: GameState, run: PracticeRun, expected: { id: string; index: number }, action: Action): PracticeRun {
  return run.id === expected.id && run.actions.length === expected.index ? playPractice(original, run, action) : run;
}
export function restorePractice(original: GameState, source: string, saved: PracticeSave): PracticeRun {
  if (saved.source !== source || !Array.isArray(saved.actions) || saved.actions.length > 40
    || typeof saved.seed !== 'string' || typeof saved.id !== 'string' || typeof saved.created !== 'string') throw new Error('This saved practice cannot be opened.');
  let run = startPractice(original, saved);
  for (const action of saved.actions) run = playPractice(original, run, action);
  return run;
}
export function practiceSave(run: PracticeRun): PracticeSave {
  const { game: _game, branchAt: _branchAt, ...save } = run;
  return save;
}
