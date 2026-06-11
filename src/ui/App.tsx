/**
 * App shell: screen routing + the only effectful code in the UI —
 *   - schedules one AI step whenever an AI seat is on turn (pendingAiSeat),
 *   - clears the completed-trick pause after a short look,
 *   - persists settings + in-progress game to localStorage.
 * All decisions live in the pure store (src/ui/store.ts).
 */

import { useEffect, useReducer } from 'preact/hooks';
import {
  TRICK_SHOW_MS, aiDelayMs, initialApp, loadApp, pendingAiSeat, reducer, saveApp,
} from './store';
import { Home, HowTo, About } from './Home';
import { Table } from './Table';
import './app.css';

export function App() {
  const [app, dispatch] = useReducer(reducer, undefined, () =>
    initialApp(typeof localStorage !== 'undefined' ? loadApp(localStorage) : null),
  );

  // Drive AI turns and the trick pause. Timers only — logic is in the store.
  useEffect(() => {
    if (pendingAiSeat(app) !== null) {
      const t = setTimeout(() => dispatch({ type: 'ai' }), aiDelayMs(app));
      return () => clearTimeout(t);
    }
    if (app.showTrick) {
      const t = setTimeout(() => dispatch({ type: 'trick-shown' }), TRICK_SHOW_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [app]);

  // Persist settings + in-progress game.
  useEffect(() => {
    if (typeof localStorage !== 'undefined') saveApp(localStorage, app);
  }, [app.game, app.settings, app.seed, app.aiMoves]);

  switch (app.screen) {
    case 'home':
      return <Home app={app} dispatch={dispatch} />;
    case 'how':
      return <HowTo dispatch={dispatch} />;
    case 'about':
      return <About dispatch={dispatch} />;
    case 'table':
      return app.game ? (
        <Table app={app} dispatch={dispatch} />
      ) : (
        <Home app={app} dispatch={dispatch} />
      );
  }
}
