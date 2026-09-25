/**
 * App shell: screen routing + the only effectful code in the UI —
 *   - schedules one AI step whenever an AI seat is on turn (pendingAiSeat),
 *   - clears the completed-trick pause after a short look,
 *   - persists settings + in-progress game to localStorage.
 * All decisions live in the pure store (src/ui/store.ts).
 */

import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { Seat } from '../engine';
import {
  HUMAN_SEAT, TRICK_SHOW_MS, nelloAvailable, aiDelayMs, initialApp, loadApp, pendingAiSeat, reducer, saveApp,
} from './store';
import {
  BUILD_ID, UPDATE_POLL_MS, fetchRemoteVersion, updateAvailable,
} from './update';
import { Home, HowTo, About } from './Home';
import { Table } from './Table';
import { codeFromHash, decodeHand } from './share';
import { decodeObservation } from './observation-link';
import { api, isNative, nativeMove, NATIVE_TABLE, type FlagRecord } from '../ai/native';
import { anticipatedAuctions, auctionMove } from '../ai/auction';
import { AuctionPreparation } from '../ai/auction-preparation';
import './app.css';
import { Questions } from './Questions';
import { attachGame, syncQuestions } from '../questions/client';

export function App() {
  const [app, dispatch] = useReducer(reducer, undefined, () =>
    initialApp(typeof localStorage !== 'undefined' ? loadApp(localStorage) : null, location.search),
  );

  const [questions, setQuestions] = useState<{ id: string | null } | null>(null);
  const openQuestion = (id: string) => setQuestions({ id });
  useEffect(() => {
    const sync = () => void syncQuestions();
    const timer = setInterval(sync, 30000);
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    sync();
    return () => { clearInterval(timer); window.removeEventListener('online', sync); window.removeEventListener('focus', sync); };
  }, []);
  useEffect(() => {
    const attach = () => { if (app.game) void attachGame(app.game, app.sessionId).then(() => syncQuestions()).catch(() => {}); };
    attach();
    window.addEventListener('plunge-questions-changed', attach);
    return () => window.removeEventListener('plunge-questions-changed', attach);
  }, [app.game, app.sessionId]);

  const preparation = useRef<AuctionPreparation>();
  useEffect(() => {
    if (NATIVE_TABLE || !isNative(app.settings.difficulty) || app.screen !== 'table'
      || app.scenarioGame || questions || app.game?.phase !== 'bidding') return;
    const current = new AuctionPreparation();
    preparation.current = current;
    return () => { current.close(); preparation.current = undefined; };
  }, [app.sessionId, app.game?.handNumber, app.game?.phase === 'bidding', app.screen,
    app.scenarioGame !== null, app.settings.difficulty, questions !== null]);
  useEffect(() => {
    if (app.game?.turn === HUMAN_SEAT && !questions) {
      preparation.current?.prepare(anticipatedAuctions(app.game, app.sessionId, HUMAN_SEAT));
    } else preparation.current?.pause();
  }, [app.game, app.sessionId, app.screen, app.settings.difficulty, questions !== null, app.scenarioGame]);

  // The same shared player runs through a native transport or a browser worker.
  const [thinking, setThinking] = useState<Seat | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setNativeError(null);
    if (questions) return;
    const seat = pendingAiSeat(app);
    if (seat !== null) {
      let alive = true;
      const controller = new AbortController();
      let t: ReturnType<typeof setTimeout> | undefined;
      if (isNative(app.settings.difficulty) && app.game && ['bidding','declaring'].includes(app.game.phase)) {
        // Think during the presentation pause, then reveal the bid at its usual pace.
        const started = performance.now();
        setThinking(seat);
        void auctionMove(app.game,seat,app.sessionId,app.auctionSurveys[`${app.game.handNumber}:${seat}`],controller.signal,preparation.current?.evaluate).then(
          decision => {
            if (!alive) return;
            t = setTimeout(() => { if (alive) dispatch({type:'auction-ai',decision}); },
              Math.max(0, aiDelayMs(app) - (performance.now() - started)));
          },
          (error:unknown) => { if (alive) setNativeError(String(error)); },
        ).finally(() => { if (alive) setThinking(null); });
      } else t = setTimeout(() => {
        if (isNative(app.settings.difficulty) && app.game?.phase === 'playing') {
          setThinking(seat);
          void nativeMove(app.game, seat, app.settings.difficulty, app.sessionId, controller.signal, app.settings.thinkDeeper).then(
            (receipt) => { if (alive) dispatch({ type: 'native-ai', receipt }); },
            (error: unknown) => { if (alive) setNativeError(String(error)); },
          ).finally(() => { if (alive) setThinking(null); });
          return;
        }
        dispatch({ type: 'ai' });
      }, aiDelayMs(app));
      return () => {
        alive = false;
        if (t !== undefined) clearTimeout(t);
        controller.abort();
        setThinking(null);
      };
    }
    if (app.showTrick) {
      const t = setTimeout(() => dispatch({ type: 'trick-shown' }), TRICK_SHOW_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [app, retry, questions]);

  // Persist settings + in-progress game. (A shared hand opened from a link
  // is never part of the save — the player's own game stays underneath.)
  useEffect(() => {
    if (typeof localStorage !== 'undefined') saveApp(localStorage, app);
  }, [app.game, app.settings, app.seed, app.aiMoves, app.nativeReceipts, app.auctionSurveys, app.sessionId]);

  // A share link (#r=...) opens that hand in view-only review. The hash is
  // consumed on load so reloads and future navigation stay clean.
  useEffect(() => {
    let generation = 0;
    const open = (): void => {
      const request = ++generation;
      const questionId = /^#question=([a-f0-9]{32})$/.exec(location.hash)?.[1];
      if (questionId) {
        history.replaceState(null, '', location.pathname + location.search);
        setQuestions({ id: questionId });
        return;
      }
      if (location.hash.startsWith('#q=')) {
        const observation = decodeObservation(location.hash);
        if (!observation) { setNativeError('This observation link could not be replayed.'); return; }
        history.replaceState(null, '', location.pathname + location.search);
        dispatch({ type: 'view-scenario', ...observation });
        return;
      }
      const flagId = /(?:^#|&)flag=([a-f0-9]{32})/.exec(location.hash)?.[1];
      if (flagId) {
        void api<FlagRecord>(`flags/${flagId}`).then((flag) => {
          const game = decodeHand(flag.share_code);
          if (!game) throw new Error('The saved hand could not be replayed.');
          if (request === generation) {
            history.replaceState(null, '', location.pathname + location.search);
            dispatch({ type: 'view-scenario', game, flag });
          }
        }).catch((error: unknown) => { if (request === generation) setNativeError(String(error)); });
        return;
      }
      const code = codeFromHash(location.hash);
      if (!code) return;
      history.replaceState(null, '', location.pathname + location.search);
      const game = decodeHand(code);
      if (game) dispatch({ type: 'view-scenario', game });
    };
    open(); window.addEventListener('hashchange', open);
    return () => { generation++; window.removeEventListener('hashchange', open); };
  }, [retry]);

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
        return <Home app={app} dispatch={dispatch} onQuestions={() => setQuestions({ id: null })} />;
      case 'how':
        return <HowTo dispatch={dispatch} />;
      case 'about':
        return <About dispatch={dispatch} />;
      case 'table':
        return app.game || app.scenarioGame ? (
          <Table app={app} dispatch={dispatch} thinking={thinking} onQuestion={openQuestion} />
        ) : (
          <Home app={app} dispatch={dispatch} onQuestions={() => setQuestions({ id: null })} />
        );
    }
  })();

  return (
    <>
      {screen}
      {questions && <Questions nelloPreview={nelloAvailable(app.settings)} key={questions.id ?? "list"} initialId={questions.id} onClose={() => setQuestions(null)} dispatch={dispatch} />}
      {nativeError && (
        <div class="native-error" role="alert">
          <span>{nativeError}</span>
          <button type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </div>
      )}
      {updateBanner}
    </>
  );
}
