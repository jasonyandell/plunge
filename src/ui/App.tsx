/**
 * App shell: screen routing + the only effectful code in the UI —
 *   - schedules one AI step whenever an AI seat is on turn (pendingAiSeat),
 *   - clears the completed-trick pause after a short look,
 *   - persists settings + in-progress game to localStorage.
 * All decisions live in the pure store (src/ui/store.ts).
 */

import { useEffect, useReducer, useState } from 'preact/hooks';
import type { Seat } from '../engine';
import { preloadOnyx, preloadWalt, prewarmOnyx, prewarmWalt } from '../ai';
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

  // Warm the selected model once (idempotent; a load failure leaves the
  // difficulty degrading to hard, so this never blocks play).
  useEffect(() => {
    if (app.settings.difficulty === 'onyx') void preloadOnyx();
    if (app.settings.difficulty === 'walt') void preloadWalt();
  }, [app.settings.difficulty]);

  // Drive AI turns and the trick pause. Timers only — logic is in the store.
  // For onyx/walt, pre-warm the response cache for the pending seat during
  // the think delay, so the synchronous 'ai' step hits the cache (cache miss
  // is a safe hard fallback). walt can genuinely think for seconds at an
  // opening lead — the dispatch simply waits for the pre-warm to settle, and
  // once a think runs long (>350ms) the table shows who's thinking so the
  // pause never reads as a hang.
  const [thinking, setThinking] = useState<Seat | null>(null);
  useEffect(() => {
    const seat = pendingAiSeat(app);
    if (seat !== null) {
      const prewarm =
        app.settings.difficulty === 'onyx'
          ? prewarmOnyx
          : app.settings.difficulty === 'walt'
            ? prewarmWalt
            : null;
      let alive = true;
      let slow: ReturnType<typeof setTimeout> | undefined;
      const t = setTimeout(() => {
        if (!prewarm || !app.game) {
          dispatch({ type: 'ai' });
          return;
        }
        slow = setTimeout(() => {
          if (alive) setThinking(seat);
        }, 350);
        void prewarm(app.game, seat).finally(() => {
          clearTimeout(slow);
          if (alive) {
            setThinking(null);
            dispatch({ type: 'ai' });
          }
        });
      }, aiDelayMs(app));
      return () => {
        alive = false;
        clearTimeout(t);
        clearTimeout(slow);
        setThinking(null);
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
          <Table app={app} dispatch={dispatch} thinking={thinking} />
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
