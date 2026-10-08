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
import type { ComponentChildren } from 'preact';
import type { CompletedTrick, GameState, PlayRecord, Seat } from '../engine';
import { legalDominoes } from '../engine';
import { Domino } from './Domino';
import { Tally } from './Tally';
import type { AppEvent, AppState } from './store';
import {
  HUMAN_SEAT, SEAT_NAMES, nelloAvailable, TRICK_HOLD_MS, bidLabel, contractLabel, declLabel, ledChip, trumpChip,
  canRestart, canUndo, liveDispatch, questionGameId,
} from './store';
import { BidSheet, DeclareSheet, GameOverSheet, HandOverSheet, RestartConfirm } from './sheets';
import { TrickHistory } from './TrickHistory';
import { NativeReview } from './NativeReview';
import { MoveHint } from './MoveHint';
import { HintsSwitch } from './Home';
import { isNative } from '../ai/native';
import './table.css';
import './questions.css';
import { saveQuestion } from '../questions/client';
import { MoveQuestionPrompt } from './MoveQuestionPrompt';

const POS: readonly string[] = ['bottom', 'left', 'top', 'right'];

interface QuestionSelection {
  game: GameState;
  ply: number;
  sessionId: string;
  questionGameId: string;
  receiptId: string | null;
  target: HTMLElement;
  label: string;
}

/** After an undo lands, the button rests briefly so a double tap can't take back two moves. */
export const UNDO_REST_MS = 700;

interface TableProps {
  app: AppState;
  dispatch: (e: AppEvent) => void;
  /** Seat whose slow AI think is in flight (walt solving) — shows a note. */
  thinking?: Seat | null;
  onQuestion: (id: string) => void;
  /** A shared table's word under a seat: rejoining, or Walt covering an absent person. */
  seatNote?: (seat: Seat) => string | null;
  /** A shared table's extra menu entry. */
  menuExtra?: ComponentChildren;
  onHistory?: () => void;
}

export function Table({ app, dispatch: rawDispatch, thinking = null, onQuestion, seatNote = () => null, menuExtra = null, onHistory }: TableProps) {
  // Every human decision below — tiles, bid/trump sheets, end cards — is
  // stamped with the generation this render shows (see liveDispatch).
  const dispatch = liveDispatch(rawDispatch, app.epoch);
  const [question, setQuestion] = useState<QuestionSelection | null>(null);
  const g = app.scenarioGame ?? app.game;
  useEffect(() => setQuestion(null), [app.sessionId, g?.handNumber, app.scenarioGame, app.epoch]);
  // Undo and replay are deliberate: Undo rests after each use; replaying asks first.
  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (!resting) return;
    const timer = setTimeout(() => setResting(false), UNDO_REST_MS);
    return () => clearTimeout(timer);
  }, [resting]);
  const [confirmRestart, setConfirmRestart] = useState<number | null>(null);
  useEffect(() => setConfirmRestart(null), [app.sessionId, g?.handNumber, app.scenarioGame, app.epoch]);
  const [saved, setSaved] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 7000);
    return () => clearTimeout(timer);
  }, [saved]);
  const [playError, setPlayError] = useState<string | null>(null);
  useEffect(() => setPlayError(null), [g, app.settings.showHints]);
  const [histOpen, setHistOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // A shared hand from a link is shown instead of the player's own game,
  // view-only, and opens straight into review.
  const scenario = app.scenarioGame !== null;
  // Reviewing the finished hand: hides the end-of-hand card in favor of the
  // trick-by-trick history until the player comes back to the result.
  const [review, setReview] = useState(scenario);
  // At a shared table Undo is a vote; one question at a time.
  const undoReady = !scenario && !resting && canUndo(app) && !app.room?.table?.proposal;
  const restartReady = !scenario && canRestart(app);
  const undo = (): void => {
    if (!undoReady) return;
    setResting(true);
    dispatch({ type: 'undo', epoch: app.epoch });
  };
  const askRestart = (): void => { if (restartReady) setConfirmRestart(app.epoch); };
  const branch = questionGameId(app);
  // Undone or replayed: shown on the table and the end cards, not only in exports.
  const practice = !scenario && !!g && app.retry?.handNumber === g.handNumber;
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
    setQuestion({ game: g, ply, sessionId: app.sessionId, questionGameId: branch, target,
      receiptId: app.nativeReceipts[`${g.handNumber}:${ply}`] ?? null,
      label: `${play.seat === HUMAN_SEAT ? 'You' : SEAT_NAMES[play.seat]} · ${play.domino.split('').join('–')}` });
  };
  const bookmark = (selected: QuestionSelection): void => {
    setQuestion(null);
    void saveQuestion(selected.game, selected.ply, selected.sessionId, selected.receiptId,
      undefined, null, null, undefined, selected.questionGameId)
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

  return (
    <div class="table-screen" style={{ '--trick-hold-ms': `${TRICK_HOLD_MS}ms` }}>
      <StatusStrip g={g} onMenu={() => setMenuOpen(true)} />
      {!scenario && !review && (
        <div class="hand-tools">
          {practice && <span class="practice-chip" title="Undone or replayed: kept as practice, not counted in stats">Practice</span>}
          <button type="button" class="hand-tool" disabled={!undoReady} onClick={undo}
            aria-label={app.room ? 'Undo the last human move' : 'Undo your last move'}>&#8630; Undo</button>
          {!app.room && <button type="button" class="hand-tool" disabled={!restartReady} onClick={askRestart}>
            &#8635; Play this hand again
          </button>}
        </div>
      )}
      {(g.phase === 'playing' || showingLast) && (
        <InfoBar
          g={g}
          plays={trickPlays}
          open={histOpen}
          onToggle={() => setHistOpen((o) => !o)}
          onQuestion={scenario ? undefined : selectQuestion}
        />
      )}
      <div class="felt">
        <OpponentTop g={g} thinking={thinking} note={seatNote(2)} />
        <div class="middle">
          <OpponentSide g={g} seat={1} thinking={thinking} note={seatNote(1)} />
          <TrickArea
            g={g}
            plays={trickPlays}
            winner={trickWinner}
            gathering={showingLast}
            thinking={thinking}
            onQuestion={scenario ? undefined : (i, target) => selectQuestion(playIndex(g,showingLast ? g.tricks.length - 1 : g.tricks.length,i), target)}
          />
          <OpponentSide g={g} seat={3} thinking={thinking} note={seatNote(3)} />
        </div>
        <div class="hand-area">
          <div class="hand-heading">
            <p class={`hand-caption${humanTurn && !showingLast ? ' your-turn' : ''}`} role="status">
              <strong class="you-label">You</strong>
              <span>{humanTurn && !showingLast
                ? g.currentTrick.length === 0 ? 'Your turn to lead' : 'Your turn to play'
                : 'Your hand'}</span>
            </p>
            {app.settings.showHints && humanTurn && !showingLast && !scenario && explainScope(g) && isNative(app.settings.difficulty) &&
              <MoveHint key={`${app.sessionId}:${app.epoch}:${g.handNumber}:${g.tricks.length}:${g.currentTrick.length}`} g={g} sessionId={app.sessionId} questionGameId={branch} onQuestion={onQuestion} />}
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
      </div>

      {saved && <div class="question-toast" role="status"><span>{saved.text}</span>{saved.id && <button class="text-btn" onClick={() => { onQuestion(saved.id); setSaved(null); }}>Add note</button>}</div>}
      {question && <MoveQuestionPrompt key={`${question.sessionId}:${question.game.handNumber}:${question.ply}`}
        target={question.target} label={question.label} onSave={() => bookmark(question)} onClose={() => setQuestion(null)} />}
      {g.phase === 'bidding' && g.turn === HUMAN_SEAT && <BidSheet key={app.epoch} showHints={app.settings.showHints} g={g} dispatch={dispatch} sessionId={app.sessionId} questionGameId={branch} onQuestion={onQuestion} />}
      {g.phase === 'declaring' && g.turn === HUMAN_SEAT && <DeclareSheet key={app.epoch} showHints={app.settings.showHints} g={g} dispatch={dispatch} sessionId={app.sessionId} questionGameId={branch} onQuestion={onQuestion} />}
      {g.phase === 'hand-over' && !showingLast && !review && (
        <HandOverSheet
          g={g}
          dispatch={dispatch}
          onReview={g.tricks.length > 0 ? () => setReview(true) : undefined}
          scenario={scenario}
          onHistory={scenario ? undefined : onHistory}
          practice={practice}
          onUndo={undoReady ? undo : undefined}
          onRestart={restartReady ? askRestart : undefined}
        />
      )}
      {g.phase === 'game-over' && !showingLast && !review && (
        <GameOverSheet
          g={g}
          dispatch={dispatch}
          onHistory={scenario ? undefined : onHistory}
          onReview={g.tricks.length > 0 ? () => setReview(true) : undefined}
          practice={practice}
          onUndo={undoReady ? undo : undefined}
          onRestart={restartReady ? askRestart : undefined}
        />
      )}
      {(g.phase === 'hand-over' || g.phase === 'game-over') && review && (
          <NativeReview key={scenario ? (app.scenarioFlag?.id ?? g.dealt.flat().join('')) : `${app.sessionId}:${app.epoch}:${g.handNumber}`}
            g={g} nelloPreview={nelloAvailable(app.settings)} onBack={() => setReview(false)} sessionId={app.sessionId} questionGameId={branch}
            receipts={scenario ? {} : app.nativeReceipts} initialFlag={app.scenarioFlag} onQuestion={onQuestion} />
      )}
      {menuOpen && (
        <GameMenu app={app} dispatch={dispatch} onClose={() => setMenuOpen(false)} extra={menuExtra}
          onHome={() => { setMenuOpen(false); dispatch({ type: 'go', screen: 'home' }); }} />
      )}
      {confirmRestart !== null && !scenario && (
        <RestartConfirm
          onConfirm={() => { dispatch({ type: 'restart-hand', epoch: confirmRestart }); setConfirmRestart(null); }}
          onCancel={() => setConfirmRestart(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/** The table's ☰: decide on hints mid-game, or step back to Home. */
function GameMenu({ app, dispatch, onClose, onHome, extra }: {
  app: AppState; dispatch: (e: AppEvent) => void; onClose: () => void; onHome: () => void; extra?: ComponentChildren;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="overlay game-menu-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="card game-menu" role="dialog" aria-label="Menu">
        <HintsSwitch app={app} dispatch={dispatch} />
        {extra}
        <button type="button" class="big-btn" onClick={onClose}>Keep playing</button>
        <button type="button" class="big-btn secondary" onClick={onHome}>Back to home</button>
      </div>
    </div>
  );
}

function StatusStrip({ g, onMenu }: { g: GameState; onMenu: () => void }) {
  return (
    <header class="status">
      <button
        type="button"
        class="menu-btn"
        aria-label="Menu"
        aria-haspopup="dialog"
        onClick={onMenu}
      >
        &#9776;
      </button>
      <div class="status-mid">
        <div class="status-line">{statusLine(g)}</div>
        {g.phase === 'bidding' && <div class="status-sub">{g.shaker === HUMAN_SEAT ? 'You' : SEAT_NAMES[g.shaker]} shook</div>}
        {g.phase === 'playing' && (
          <div class="status-sub" aria-label="Points this hand">
            Us {g.points[0] ?? 0} &middot; Them {g.points[1] ?? 0}
          </div>
        )}
      </div>
      <div class="status-tallies">
        <Tally marks={g.marks[0] ?? 0} label="Us" />
        <Tally marks={g.marks[1] ?? 0} label="Them" />
      </div>
    </header>
  );
}

function statusLine(g: GameState): string {
  const name = (s: Seat | null) => (s === null ? '' : s === HUMAN_SEAT ? 'You' : SEAT_NAMES[s] ?? '');
  switch (g.phase) {
    case 'bidding':
      return `Hand ${g.handNumber} · Bidding`;
    case 'declaring':
      return `${name(g.declarer)} won the bid at ${g.contract ? contractLabel(g.contract) : ''}`;
    case 'playing':
      // Trump itself lives in the info bar chip, where it can't truncate.
      return `${name(g.declarer)} bid ${g.contract ? contractLabel(g.contract) : ''}`;
    case 'hand-over':
      return 'Hand over';
    case 'game-over':
      return 'Game over';
  }
}

// ---------------------------------------------------------------------------

/** Persistent, readable answers to "what is trump?" and "what was led?". */
function InfoBar({
  g,
  plays,
  open,
  onToggle,
  onQuestion,
}: {
  g: GameState;
  plays: readonly PlayRecord[];
  open: boolean;
  onToggle: () => void;
  onQuestion?: ((ply: number, target: HTMLElement) => void) | undefined;
}) {
  const trump = trumpChip(g);
  const led = ledChip(g, plays);
  const [trumpName, trumpDetail] = (trump ?? '').replace(/^trump: /, '').split(' — ');
  const ledName = led === 'trumps' && g.declaration ? declLabel(g.declaration) : led;
  const n = g.tricks.length;
  return (
    <div class="info-wrap">
      <div class="info-bar">
        <div class="suit-card suit-trump">
          <span class="suit-label">Trump</span>
          <strong class="suit-name">{g.declaration?.type === 'no-trump' ? 'None' : trumpName}</strong>
          {trumpDetail && <span class="suit-detail">{trumpDetail}</span>}
        </div>
        <div class="suit-card suit-led" aria-live="polite" aria-atomic="true">
          <span class="suit-label">Suit led</span>
          <strong class={`suit-name${ledName ? '' : ' no-lead'}`}>{ledName ?? 'Not led yet'}</strong>
        </div>
        {n > 0 && (
          <button
            type="button"
            class="hist-toggle"
            aria-expanded={open}
            aria-label={`Trick history, ${n} ${n === 1 ? 'trick' : 'tricks'} so far`}
            onClick={onToggle}
          >
            Tricks ({n}) {open ? '▴' : '▾'}
          </button>
        )}
      </div>
      {open && n > 0 && <>{onQuestion && <p class="question-history-hint">Curious about a move? Tap its domino.</p>}<TrickHistory g={g} actionLabel="Why this move?" onTapPlay={onQuestion ? (t, p, target) => onQuestion(playIndex(g,t,p), target) : undefined} /></>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function bidBubble(g: GameState, seat: Seat) {
  if (g.phase !== 'bidding' && g.phase !== 'declaring') return null;
  const sb = g.bids.find((b) => b.seat === seat);
  if (!sb) {
    return g.phase === 'bidding' && g.turn === seat ? (
      <span class="bubble thinking">&hellip;</span>
    ) : null;
  }
  return <span class={`bubble${sb.bid.kind === 'pass' ? ' pass' : ''}`}>{bidLabel(sb.bid)}</span>;
}

function seatBadges(g: GameState, seat: Seat) {
  return (
    <>
      {g.shaker === seat && <span class="badge shaker" title="Shook this hand">&#9860;</span>}
      {g.declarer === seat && g.phase !== 'bidding' && <span class="badge decl">bid</span>}
    </>
  );
}

function OpponentTop({ g, thinking, note }: { g: GameState; thinking: Seat | null; note?: string | null }) {
  const seat: Seat = 2;
  const hand = g.hands[seat] ?? [];
  const sitsOut = g.sittingOut === seat;
  const active = g.turn === seat;
  return (
    <div class={`seat seat-top${active ? ' active' : ''}${thinking === seat ? ' seat-thinking' : ''}`}>
      <div class="seat-name">
        {SEAT_NAMES[seat]} <span class="seat-tag">Your partner</span>{note && <span class="seat-tag seat-note">{note}</span>} {seatBadges(g, seat)} {bidBubble(g, seat)}
      </div>
      <div class={`mini-row${sitsOut ? ' sitting' : ''}`}>
        {hand.map((id) => (
          <Domino key={id} faceDown orientation="v" className="mini-v" />
        ))}
      </div>
      {sitsOut && <div class="sit-note">sitting this one out</div>}
    </div>
  );
}

function OpponentSide({ g, seat, thinking, note }: { g: GameState; seat: Seat; thinking: Seat | null; note?: string | null }) {
  const hand = g.hands[seat] ?? [];
  const sitsOut = g.sittingOut === seat;
  const active = g.turn === seat;
  return (
    <div class={`seat seat-${POS[seat]}${active ? ' active' : ''}${thinking === seat ? ' seat-thinking' : ''}`}>
      <div class="seat-name">
        {SEAT_NAMES[seat]}{note && <span class="seat-tag seat-note">{note}</span>} {seatBadges(g, seat)} {bidBubble(g, seat)}
      </div>
      <div class={`mini-col${sitsOut ? ' sitting' : ''}`}>
        {hand.map((id) => (
          <Domino key={id} faceDown orientation="h" className="mini-h" />
        ))}
      </div>
      {sitsOut && <div class="sit-note">sitting out</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TrickArea({
  g,
  plays,
  winner,
  gathering,
  thinking,
  onQuestion,
}: {
  g: GameState;
  plays: readonly PlayRecord[];
  winner: Seat | null;
  gathering: boolean;
  thinking: Seat | null;
  onQuestion?: ((play: number, target: HTMLElement) => void) | undefined;
}) {
  const leader = plays[0]?.seat ?? null;
  const partnerCallsTrump =
    g.phase === 'declaring' &&
    g.contract !== null &&
    (g.contract.kind === 'plunge' || g.contract.kind === 'splash') &&
    g.turn !== null &&
    g.turn !== HUMAN_SEAT;
  return (
    <div class="trick">
      {partnerCallsTrump && g.turn !== null && g.declarer !== null && (
        <div class="trick-note">
          {SEAT_NAMES[g.turn]} is calling trump for {g.declarer === HUMAN_SEAT ? 'you' : SEAT_NAMES[g.declarer]}&hellip;
        </div>
      )}
      {!partnerCallsTrump && !gathering && thinking !== null && thinking !== HUMAN_SEAT && (
        <div class="trick-note thinking-note" role="status">
          <span class="thinking-words">
            <strong>{SEAT_NAMES[thinking]}</strong>
            <span>{g.phase === 'bidding' ? 'Choosing a bid' : g.phase === 'declaring' ? 'Choosing trump' : 'Thinking it over'}</span>
          </span>
          <span class="thinking-pips" aria-hidden="true">
            <i /><i /><i />
          </span>
        </div>
      )}
      <div class={`trick-plays${gathering && winner !== null ? ` gather-${POS[winner]}` : ''}`}>
      {plays.map((p, i) => (
        <div
          key={`${p.seat}-${p.domino}`}
          class={[
            'trick-slot',
            `slot-${POS[p.seat]}`,
            `enter-${POS[p.seat]}`,
            p.seat === leader ? 'led' : '',
            winner !== null && p.seat === winner ? 'won' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {onQuestion ? <button class="played-domino" type="button" disabled={gathering}
            aria-label={`About ${p.seat === HUMAN_SEAT ? 'your' : SEAT_NAMES[p.seat] + '’s'} ${p.domino.split('').join('–')}`}
            onClick={event => onQuestion(i, event.currentTarget)}>
            <Domino id={p.domino} orientation="h" className="trick-dom" />
          </button> : <Domino id={p.domino} orientation="h" className="trick-dom" />}
          {p.seat === leader && (
            <span class="led-tag">{p.seat === HUMAN_SEAT ? 'You' : SEAT_NAMES[p.seat]} led</span>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
