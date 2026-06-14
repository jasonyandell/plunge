/**
 * App shell: screen routing + the only effectful code in the UI —
 *   - schedules one AI step whenever an AI seat is on turn (pendingAiSeat),
 *   - clears the completed-trick pause after a short look,
 *   - persists settings + in-progress game to localStorage.
 * All decisions live in the pure store (src/ui/store.ts).
 */

import { useEffect, useReducer, useState } from 'preact/hooks';
import { preloadOnyx, prewarmOnyx } from '../ai';
import {
  TRICK_SHOW_MS, aiDelayMs, initialApp, loadApp, pendingAiSeat, reducer, saveApp,
} from './store';
import {
  BUILD_ID, UPDATE_POLL_MS, fetchRemoteVersion, updateAvailable,
} from './update';
import { Home, HowTo, About } from './Home';
import { Table } from './Table';
import './app.css';

export function App() {
  const [app, dispatch] = useReducer(reducer, undefined, () =>
    initialApp(typeof localStorage !== 'undefined' ? loadApp(localStorage) : null),
  );

  // Warm the onyx model once if it's the selected difficulty (idempotent;
  // a load failure leaves onyx degrading to hard, so this never blocks play).
  useEffect(() => {
    if (app.settings.difficulty === 'onyx') void preloadOnyx();
  }, [app.settings.difficulty]);

  // Drive AI turns and the trick pause. Timers only — logic is in the store.
  // For onyx, pre-warm the prediction cache for the pending seat during the
  // think delay, so the synchronous 'ai' step hits the cache (cache miss is a
  // safe hard fallback). Other difficulties are fully synchronous as before.
  useEffect(() => {
    const seat = pendingAiSeat(app);
    if (seat !== null) {
      const onyx = app.settings.difficulty === 'onyx';
      let alive = true;
      const t = setTimeout(() => {
        if (!onyx || !app.game) {
          dispatch({ type: 'ai' });
          return;
        }
        void prewarmOnyx(app.game, seat).finally(() => {
          if (alive) dispatch({ type: 'ai' });
        });
      }, aiDelayMs(app));
      return () => {
        alive = false;
        clearTimeout(t);
      };
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

  // Deploy-aware reload (issue #2): poll /version.json, offer a reload when a
  // fresh deploy lands. The game is already saved, so reloading is safe.
  const [updateReady, setUpdateReady] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  useEffect(() => {
    if (BUILD_ID === 'dev') return undefined;
    let live = true;
    const check = async () => {
      if (updateAvailable(BUILD_ID, await fetchRemoteVersion()) && live) setUpdateReady(true);
    };
    const t = setInterval(check, UPDATE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const updateBanner = updateReady && !updateDismissed && (
    <div class="update-banner" role="status">
      <span>A fresh version's been dealt.</span>
      <button type="button" class="update-reload" onClick={() => location.reload()}>
        Reload
      </button>
      <button
        type="button"
        class="update-dismiss"
        aria-label="Not now"
        onClick={() => setUpdateDismissed(true)}
      >
        Not now
      </button>
    </div>
  );

  const screen = (() => {
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
  })();

  return (
    <>
      {screen}
      {updateBanner}
    </>
  );
}
