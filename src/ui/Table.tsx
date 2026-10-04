import { explainScope } from '../ai/review-request';
import { playIndex } from '../engine/play-index';
/**
 * The table screen. Renders purely from GameState — no duplicated game state.
 *
 * Seating (clockwise = ascending seats): you (0) at the bottom, Earl (1) to
 * your left, Gran (2) — your partner — across the top, Ruby (3) to your right.
 *
 * Portrait layout keeps the suit panels and labeled hand visible. The middle
 * table flexes to the available height; hand tiles cap at 58px wide.
 */

import { useEffect, useState } from 'preact/hooks';
import type { CompletedTrick, GameState, PlayRecord, Seat } from '../engine';
import { legalDominoes } from '../engine';
import { Domino } from './Domino';
import type { AppEvent, AppState } from './store';
import { HUMAN_SEAT, SEAT_NAMES, nelloAvailable, TRICK_HOLD_MS } from './store';
import { BidSheet, DeclareSheet, GameOverSheet, HandOverSheet } from './sheets';
import { Felt, InfoBar, StatusStrip } from './TableFelt';
import { NativeReview } from './NativeReview';
import { MoveHint } from './MoveHint';
import { isNative } from '../ai/native';
import './table.css';
import './questions.css';
import { saveQuestion } from '../questions/client';
import { MoveQuestionPrompt } from './MoveQuestionPrompt';

interface QuestionSelection {
  game: GameState;
  ply: number;
  sessionId: string;
  receiptId: string | null;
  target: HTMLElement;
  label: string;
}

interface TableProps {
  app: AppState;
  dispatch: (e: AppEvent) => void;
  /** Seat whose slow AI think is in flight (walt solving) — shows a note. */
  thinking?: Seat | null;
  onQuestion: (id: string) => void;
  /** Opens past-hand replay over the table; this game stays paused underneath. */
  onPastHands?: (() => void) | undefined;
}

export function Table({ app, dispatch, thinking = null, onQuestion, onPastHands }: TableProps) {
  const [question, setQuestion] = useState<QuestionSelection | null>(null);
  const g = app.scenarioGame ?? app.game;
  useEffect(() => setQuestion(null), [app.sessionId, g?.handNumber, app.scenarioGame]);
  const [saved, setSaved] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 7000);
    return () => clearTimeout(timer);
  }, [saved]);
  const [playError, setPlayError] = useState<string | null>(null);
  useEffect(() => setPlayError(null), [g, app.settings.showHints]);
  const [histOpen, setHistOpen] = useState(false);
  // A shared hand from a link is shown instead of the player's own game,
  // view-only, and opens straight into review.
  const scenario = app.scenarioGame !== null;
  // Reviewing the finished hand: hides the end-of-hand card in favor of the
  // trick-by-trick history until the player comes back to the result.
  const [review, setReview] = useState(scenario);
  const phase = (app.scenarioGame ?? app.game)?.phase;
  useEffect(() => {
    if (phase !== 'hand-over' && phase !== 'game-over') setReview(false);
  }, [phase]);
  useEffect(() => {
    if (scenario) setReview(true);
  }, [scenario]);
  if (!g) return null;

  const selectQuestion = (ply: number, target: HTMLElement): void => {
    if (question?.target === target) { setQuestion(null); return; }
    const play = [...g.tricks.flatMap(t => t.plays), ...g.currentTrick][ply];
    if (!play) return;
    // Keep the original evidence even if the trick clears before confirmation.
    setQuestion({ game: g, ply, sessionId: app.sessionId, target,
      receiptId: app.nativeReceipts[`${g.handNumber}:${ply}`] ?? null,
      label: `${play.seat === HUMAN_SEAT ? 'You' : SEAT_NAMES[play.seat]} · ${play.domino.split('').join('–')}` });
  };
  const bookmark = (selected: QuestionSelection): void => {
    setQuestion(null);
    void saveQuestion(selected.game, selected.ply, selected.sessionId, selected.receiptId)
      .then(item => setSaved({ id: item.question.id, text: 'Saved for later' }))
      .catch(() => setSaved({ id: '', text: 'Could not save. Please try again.' }));
  };

  const lastTrick: CompletedTrick | null =
    g.tricks.length > 0 ? (g.tricks[g.tricks.length - 1] ?? null) : null;
  const showingLast = !scenario && app.showTrick && lastTrick !== null;
  const trickPlays: readonly PlayRecord[] = showingLast ? lastTrick.plays : g.currentTrick;
  const trickWinner: Seat | null = showingLast ? lastTrick.winner : null;

  const legal = new Set(g.phase === 'playing' && g.turn === HUMAN_SEAT ? legalDominoes(g) : []);
  const humanTurn = !scenario && !showingLast && g.phase === 'playing' && g.turn === HUMAN_SEAT;
  const humanHand = g.hands[HUMAN_SEAT] ?? [];
  const humanSitsOut = g.sittingOut === HUMAN_SEAT;
  const pastHands = scenario ? undefined : onPastHands;

  return (
    <div class="table-screen" style={{ '--trick-hold-ms': `${TRICK_HOLD_MS}ms` }}>
      <StatusStrip g={g} onMenu={() => dispatch({ type: 'go', screen: 'home' })} />
      {(g.phase === 'playing' || showingLast) && (
        <InfoBar
          g={g}
          plays={trickPlays}
          open={histOpen}
          onToggle={() => setHistOpen((o) => !o)}
          onQuestion={scenario ? undefined : selectQuestion}
          footer={pastHands && <button type="button" class="text-btn hist-past" onClick={pastHands}>Replay past hands ›</button>}
        />
      )}
      <Felt
        g={g}
        plays={trickPlays}
        winner={trickWinner}
        gathering={showingLast}
        thinking={thinking}
        onQuestion={scenario ? undefined : (i, target) => selectQuestion(playIndex(g,showingLast ? g.tricks.length - 1 : g.tricks.length,i), target)}
      >
        <div class="hand-area">
          <div class="hand-heading">
            <p class={`hand-caption${humanTurn && !showingLast ? ' your-turn' : ''}`} role="status">
              <strong class="you-label">You</strong>
              <span>{humanTurn && !showingLast
                ? g.currentTrick.length === 0 ? 'Your turn to lead' : 'Your turn to play'
                : 'Your hand'}</span>
            </p>
            {app.settings.showHints && humanTurn && !showingLast && !scenario && explainScope(g) && isNative(app.settings.difficulty) &&
              <MoveHint key={`${app.sessionId}:${g.handNumber}:${g.tricks.length}:${g.currentTrick.length}`} g={g} sessionId={app.sessionId} onQuestion={onQuestion} />}
          </div>
          {humanSitsOut ? (
            <div class="hand sit-out">
              {humanHand.map((id) => (
                <Domino key={id} faceDown orientation="v" />
              ))}
              <p class="sit-note">You're sitting this one out — Nel-O.</p>
            </div>
          ) : (
            <div class="hand" aria-label="Your hand">
              {humanHand.map((id) => (
                <Domino
                  key={id}
                  id={id}
                  orientation="v"
                  state={humanTurn && app.settings.showHints ? (legal.has(id) ? 'legal' : 'illegal') : 'idle'}
                  interactive={humanTurn && !app.settings.showHints}
                  onTap={() => {
                    if (!legal.has(id)) { setPlayError('You must follow suit when you can.'); return; }
                    dispatch({ type: 'human', action: { type: 'play', domino: id } });
                  }}
                />
              ))}
            </div>
          )}
          {playError && <p class="play-error" role="status">{playError}</p>}
        </div>
      </Felt>

      {saved && <div class="question-toast" role="status"><span>{saved.text}</span>{saved.id && <button class="text-btn" onClick={() => { onQuestion(saved.id); setSaved(null); }}>Add note</button>}</div>}
      {question && <MoveQuestionPrompt key={`${question.sessionId}:${question.game.handNumber}:${question.ply}`}
        target={question.target} label={question.label} onSave={() => bookmark(question)} onClose={() => setQuestion(null)} />}
      {g.phase === 'bidding' && g.turn === HUMAN_SEAT && <BidSheet showHints={app.settings.showHints} g={g} dispatch={dispatch} sessionId={app.sessionId} onQuestion={onQuestion} />}
      {g.phase === 'declaring' && g.turn === HUMAN_SEAT && <DeclareSheet showHints={app.settings.showHints} g={g} dispatch={dispatch} sessionId={app.sessionId} onQuestion={onQuestion} />}
      {g.phase === 'hand-over' && !showingLast && !review && (
        <HandOverSheet
          g={g}
          dispatch={dispatch}
          onReview={g.tricks.length > 0 ? () => setReview(true) : undefined}
          onPastHands={pastHands}
          scenario={scenario}
        />
      )}
      {g.phase === 'game-over' && !showingLast && !review && (
        <GameOverSheet
          g={g}
          dispatch={dispatch}
          onReview={g.tricks.length > 0 ? () => setReview(true) : undefined}
          onPastHands={pastHands}
        />
      )}
      {(g.phase === 'hand-over' || g.phase === 'game-over') && review && (
          <NativeReview key={scenario ? (app.scenarioFlag?.id ?? g.dealt.flat().join('')) : `${app.sessionId}:${g.handNumber}`}
            g={g} nelloPreview={nelloAvailable(app.settings)} onBack={() => setReview(false)} sessionId={app.sessionId}
            receipts={scenario ? {} : app.nativeReceipts} initialFlag={app.scenarioFlag} onQuestion={onQuestion} />
      )}
    </div>
  );
}
