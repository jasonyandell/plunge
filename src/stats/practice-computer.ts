import { legalActions, type Action, type GameState } from '../engine';
import { computerAuction } from '../ai/computer';
import { checkedAction, nativeMove, requestOf } from '../ai/native';
import { recordedAction, type PracticeRun } from './practice';

/** Original decisions are exact; new paths use the real player with only its own/public observation. */
export async function practiceComputer(original: GameState, run: PracticeRun, signal: AbortSignal): Promise<Action> {
  if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
  const recorded = recordedAction(original, run);
  if (recorded) return recorded;
  const g = run.game, seat = g.turn;
  if (seat === null || seat === run.seat) throw new Error('Not a computer turn.');
  const legal = legalActions(g);
  if (legal.length === 1) return legal[0]!;
  if (g.phase === 'bidding' || g.phase === 'declaring') return (await computerAuction('zeb', g, seat, `practice:${run.id}`, undefined, signal)).action;
  const receipt = await nativeMove(g, seat, 'zeb', `practice:${run.id}`, signal);
  return checkedAction(g, requestOf(g, seat, `practice:${run.id}`), receipt);
}
