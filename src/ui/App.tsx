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
  type AppEvent, type AppState, HUMAN_SEAT, TRICK_SHOW_MS, nelloAvailable, aiDelayMs, initialApp, loadApp, pendingAiSeat, questionGameId, reducer, saveApp, saveShowHints,
} from './store';
import { useRoom } from '../room/useRoom';
import {
  BUILD_ID, UPDATE_POLL_MS, fetchRemoteVersion, updateAvailable,
} from './update';
import { Home, HowTo, About, More } from './Home';
import { Table } from './Table';
import { codeFromHash, decodeHand } from './share';
import { decodeObservation } from './observation-link';
import { api, isNative, nativeMove, NATIVE_TABLE, type FlagRecord } from '../ai/native';
import { anticipatedAuctions, auctionMove } from '../ai/auction';
import { AuctionPreparation } from '../ai/auction-preparation';
import './app.css';
import { retryEvidence } from '../ai/phone/records';
import { recordHistory, retryHistory, exportHistory } from '../history/recorder';
import { Questions } from './Questions';
import { attachGame, syncQuestions } from '../questions/client';

export function App() {
  const [app, reduce] = useReducer((state: AppState, event: AppEvent) => {
    const next = reducer(state, event);
    // A shared table records its own canonical history (see useRoom).
    if (next.room || state.room) return next;
    // Undo and replay never discard: the branch being left is recorded first.
    // (Content-addressed, so an already-saved snapshot isn't duplicated.)
    if ((event.type === 'undo' || event.type === 'restart-hand') && next.game !== state.game) {
      void recordHistory(state).catch(() => setHistoryError('History is not saved. Keep this tab open, free device storage, then retry or export.'));
    }
    if (next.game !== state.game || next.settings !== state.settings) {
      void recordHistory(next).catch(() => setHistoryError('History is not saved. Keep this tab open, free device storage, then retry or export.'));
    }
    return next;
  }, undefined, () =>
    initialApp(typeof localStorage !== 'undefined' ? loadApp(localStorage) : null, location.search),
  );
  // A family table lives in this same app: your moves go to the room, the rest stays local.
  const room = useRoom(app, reduce);
  const dispatch = room.dispatch;

  const [historyError, setHistoryError] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const retryRecording = () => void retryHistory().then(() => setHistoryError(null)).catch(() => setHistoryError('History is not saved. Keep this tab open, free device storage, then retry or export.'));
  useEffect(() => {
    if (room.active) return;
    void recordHistory(app).then(() => setHistoryError(null)).catch(() => setHistoryError('History is not saved. Keep this tab open, free device storage, then retry or export.'));
  }, [app.game, app.sessionId, app.nativeReceipts, app.auctionSurveys, app.settings]);
  useEffect(() => {
    const evidenceFailure = () => setEvidenceError('A Walt result is only in this tab. Device storage is unavailable; keep the tab open and export your history.');
    window.addEventListener('plunge-history-storage-error', evidenceFailure);
    retryRecording();
    window.addEventListener('focus', retryRecording);
    return () => { window.removeEventListener('focus', retryRecording); window.removeEventListener('plunge-history-storage-error', evidenceFailure); };
  }, []);
  const downloadHistory = () => void exportHistory().then(data => {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `plunge-history-${new Date().toISOString().slice(0,10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }).catch(() => setHistoryError('History export failed. Keep this tab open and retry.'));

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
    const attach = () => { if (app.game) void attachGame(app.game, questionGameId(app)).then(() => syncQuestions()).catch(() => {}); };
    attach();
    window.addEventListener('plunge-questions-changed', attach);
    return () => window.removeEventListener('plunge-questions-changed', attach);
  }, [app.game, app.sessionId, app.retry]);

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
    // Every response carries the generation it was started in; after an undo or
    // replay the reducer drops it even if this cleanup hasn't run yet.
    const epoch = app.epoch;
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
            t = setTimeout(() => { if (alive) dispatch({type:'auction-ai',decision,epoch}); },
              Math.max(0, aiDelayMs(app) - (performance.now() - started)));
          },
          (error:unknown) => { if (alive) setNativeError(String(error)); },
        ).finally(() => { if (alive) setThinking(null); });
      } else t = setTimeout(() => {
        if (isNative(app.settings.difficulty) && app.game?.phase === 'playing') {
          setThinking(seat);
          void nativeMove(app.game, seat, app.settings.difficulty, app.sessionId, controller.signal, app.settings.thinkDeeper).then(
            (receipt) => { if (alive) dispatch({ type: 'native-ai', receipt, epoch }); },
            (error: unknown) => { if (alive) setNativeError(String(error)); },
          ).finally(() => { if (alive) setThinking(null); });
          return;
        }
        dispatch({ type: 'ai', epoch });
      }, aiDelayMs(app));
      return () => {
        alive = false;
        if (t !== undefined) clearTimeout(t);
        controller.abort();
        setThinking(null);
      };
    }
    if (app.showTrick && app.screen === 'table' && !app.scenarioGame) {
      const t = setTimeout(() => dispatch({ type: 'trick-shown', epoch }), TRICK_SHOW_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [app, retry, questions]);

  // Persist settings + in-progress game. (A shared hand opened from a link
  // is never part of the save — the player's own game stays underneath.)
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (room.active) saveShowHints(localStorage, app.settings.showHints); else saveApp(localStorage, app);
  }, [app.game, app.settings, app.showTrick, app.seed, app.aiMoves, app.nativeReceipts, app.auctionSurveys, app.sessionId,
    app.epoch, app.retry, app.practiceHands]);

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
    if (room.active && (room.screen || app.screen === 'table' || app.screen === 'home')) return <>
      {room.chrome}
      {room.screen ?? (app.game || app.scenarioGame
        ? <Table app={app} dispatch={dispatch} thinking={room.thinking} onQuestion={openQuestion} seatNote={room.seatNote} menuExtra={room.menu} />
        : <div class="room-wait" role="status">Connecting to the table…</div>)}
    </>;
    switch (app.screen) {
      case 'home':
        return <Home app={app} dispatch={dispatch} />;
      case 'how':
        return <HowTo dispatch={dispatch} />;
      case 'about':
        return <About dispatch={dispatch} />;
      case 'more':
        return <More app={app} dispatch={dispatch} onQuestions={() => setQuestions({ id: null })} onHistory={downloadHistory} />;
      case 'table':
        return app.game || app.scenarioGame ? (
          <Table app={app} dispatch={dispatch} thinking={thinking} onQuestion={openQuestion} />
        ) : (
          <Home app={app} dispatch={dispatch} />
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
      {evidenceError && <div class="native-error" role="alert"><span>{evidenceError}</span><button type="button" onClick={() => void retryEvidence().then(() => setEvidenceError(null)).catch(() => {})}>Retry saving</button><button type="button" onClick={downloadHistory}>Export</button></div>}
      {historyError && <div class="native-error" role="alert"><span>{historyError}</span><button type="button" onClick={retryRecording}>Retry saving</button></div>}
      {room.overlays}
      {updateBanner}
    </>
  );
}
