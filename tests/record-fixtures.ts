/** Play whole games through the table reducer with recording on, on a fixed clock. */
import { chooseAction } from '../src/ai';
import { mulberry32 } from '../src/engine';
import type { HandRecord } from '../src/records/model';
import type { JournalContext } from '../src/records/journal';
import { initialApp, recordTransition, reducer, type AppEvent, type AppState } from '../src/ui/store';

export const TEST_WALT = 'f'.repeat(64);

export function recorder(start = Date.parse('2026-09-27T12:00:00Z')) {
  let now = start, n = 0;
  const ctx = (): JournalContext => ({ now, app: 'test', walt: TEST_WALT,
    newId: () => (++n).toString(16).padStart(32, '0') });
  return {
    ctx,
    tick: (ms: number) => { now += ms; },
    step: (s: AppState, e: AppEvent, ms = 400): AppState => { now += ms; return recordTransition(s, reducer(s, e), e, ctx()); },
  };
}

/** Everyone plays the cheap legal policy; seat 0 acts through 'human' events like the table. */
export function playRecorded(seed: string, hands = Infinity, show?: (s: AppState) => AppEvent | null):
  { state: AppState; records: HandRecord[] } {
  const r = recorder(), rand = mulberry32(7);
  let s = r.step(initialApp(null), { type: 'set-difficulty', difficulty: 'easy' });
  s = r.step(s, { type: 'new-game', seed, sessionId: 'test' });
  for (let guard = 0; guard < 20000; guard++) {
    const g = s.game!;
    if (s.showTrick) { s = r.step(s, { type: 'trick-shown' }); continue; }
    if (g.phase === 'game-over' || s.outbox.length >= hands) return { state: s, records: [...s.outbox] };
    if (g.phase === 'hand-over') { s = r.step(s, { type: 'human', action: { type: 'next-hand' } }); continue; }
    const extra = show?.(s);
    if (extra) s = r.step(s, extra, 50);
    if (g.turn === 0) s = r.step(s, { type: 'human', action: chooseAction(g, 0, 'easy', rand) });
    else s = r.step(s, { type: 'ai', choose: (gg, seat) => chooseAction(gg, seat, 'easy', rand) });
  }
  throw new Error('game never finished');
}
