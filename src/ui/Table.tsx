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
import { Tally } from './Tally';
import type { AppEvent, AppState } from './store';
import {
  HUMAN_SEAT, SEAT_NAMES, bidLabel, contractLabel, declLabel, ledChip, trumpChip,
} from './store';
import { BidSheet, DeclareSheet, GameOverSheet, HandOverSheet } from './sheets';
import { TrickHistory } from './TrickHistory';
import { NativeReview } from './NativeReview';
import './table.css';
import './questions.css';
import { saveQuestion } from '../questions/client';

const POS: readonly string[] = ['bottom', 'left', 'top', 'right'];

interface TableProps {
  app: AppState;
  dispatch: (e: AppEvent) => void;
  /** Seat whose slow AI think is in flight (walt solving) — shows a note. */
  thinking?: Seat | null;
  onQuestion: (id: string) => void;
}

export function Table({ app, dispatch, thinking = null, onQuestion }: TableProps) {
  const [saved, setSaved] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 7000);
    return () => clearTimeout(timer);
  }, [saved]);
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
  const g = app.scenarioGame ?? app.game;
  if (!g) return null;

  const bookmark = (ply: number): void => {
    const frozen = g;
    void saveQuestion(frozen, ply, app.sessionId, app.nativeReceipts[`${g.handNumber}:${ply}`] ?? null)
      .then(item => setSaved({ id: item.question.id, text: 'Saved for later' }))
      .catch(() => setSaved({ id: '', text: 'Could not save. Please try again.' }));
  };

  const lastTrick: CompletedTrick | null =
    g.tricks.length > 0 ? (g.tricks[g.tricks.length - 1] ?? null) : null;
  const showingLast = app.showTrick && lastTrick !== null;
  const trickPlays: readonly PlayRecord[] = showingLast ? lastTrick.plays : g.currentTrick;
  const trickWinner: Seat | null = showingLast ? lastTrick.winner : null;

  const legal = new Set(g.phase === 'playing' && g.turn === HUMAN_SEAT ? legalDominoes(g) : []);
  const humanTurn = g.phase === 'playing' && g.turn === HUMAN_SEAT;
  const humanHand = g.hands[HUMAN_SEAT] ?? [];
  const humanSitsOut = g.sittingOut === HUMAN_SEAT;

  return (
    <div class="table-screen">
      <StatusStrip g={g} dispatch={dispatch} />
      {g.phase === 'playing' && (
        <InfoBar
          g={g}
          plays={trickPlays}
          open={histOpen}
          onToggle={() => setHistOpen((o) => !o)}
          onQuestion={scenario ? undefined : bookmark}
        />
      )}
      <div class="felt">
        <OpponentTop g={g} thinking={thinking} />
        <div class="middle">
          <OpponentSide g={g} seat={1} thinking={thinking} />
          <TrickArea
            g={g}
            plays={trickPlays}
            winner={trickWinner}
            gathering={showingLast}
            thinking={thinking}
            onQuestion={scenario ? undefined : (i) => bookmark((showingLast ? g.tricks.length - 1 : g.tricks.length) * 4 + i)}
          />
          <OpponentSide g={g} seat={3} thinking={thinking} />
        </div>
        <div class="hand-area">
          <p class={`hand-caption${humanTurn && !showingLast ? ' your-turn' : ''}`} role="status">
            <strong class="you-label">You</strong>
            <span>{humanTurn && !showingLast
              ? g.currentTrick.length === 0 ? 'Your turn to lead' : 'Your turn to play'
              : 'Your hand'}</span>
          </p>
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
                  state={humanTurn ? (legal.has(id) ? 'legal' : 'illegal') : 'idle'}
                  onTap={() => dispatch({ type: 'human', action: { type: 'play', domino: id } })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {saved && <div class="question-toast" role="status"><span>{saved.text}</span>{saved.id && <button class="text-btn" onClick={() => { onQuestion(saved.id); setSaved(null); }}>Add note</button>}</div>}
      {g.phase === 'bidding' && g.turn === HUMAN_SEAT && <BidSheet g={g} dispatch={dispatch} />}
      {g.phase === 'declaring' && g.turn === HUMAN_SEAT && <DeclareSheet g={g} dispatch={dispatch} />}
      {g.phase === 'hand-over' && !review && (
        <HandOverSheet
          g={g}
          dispatch={dispatch}
          onReview={g.tricks.length > 0 ? () => setReview(true) : undefined}
          scenario={scenario}
        />
      )}
      {g.phase === 'game-over' && !review && (
        <GameOverSheet
          g={g}
          dispatch={dispatch}
          onReview={g.tricks.length > 0 ? () => setReview(true) : undefined}
        />
      )}
      {(g.phase === 'hand-over' || g.phase === 'game-over') && review && (
          <NativeReview key={scenario ? (app.scenarioFlag?.id ?? g.dealt.flat().join('')) : `${app.sessionId}:${g.handNumber}`}
            g={g} onBack={() => setReview(false)} sessionId={app.sessionId}
            receipts={scenario ? {} : app.nativeReceipts} initialFlag={app.scenarioFlag} onQuestion={onQuestion} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

function StatusStrip({ g, dispatch }: { g: GameState; dispatch: (e: AppEvent) => void }) {
  return (
    <header class="status">
      <button
        type="button"
        class="menu-btn"
        aria-label="Back to home"
        onClick={() => dispatch({ type: 'go', screen: 'home' })}
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
  onQuestion?: ((ply: number) => void) | undefined;
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
      {open && n > 0 && <>{onQuestion && <p class="question-history-hint">Tap a played domino to save a question.</p>}<TrickHistory g={g} actionLabel="save a question" onTapPlay={onQuestion ? (t,p) => onQuestion(t*4+p) : undefined} /></>}
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

function OpponentTop({ g, thinking }: { g: GameState; thinking: Seat | null }) {
  const seat: Seat = 2;
  const hand = g.hands[seat] ?? [];
  const sitsOut = g.sittingOut === seat;
  const active = g.turn === seat;
  return (
    <div class={`seat seat-top${active ? ' active' : ''}${thinking === seat ? ' seat-thinking' : ''}`}>
      <div class="seat-name">
        Gran <span class="seat-tag">Your partner</span> {seatBadges(g, seat)} {bidBubble(g, seat)}
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

function OpponentSide({ g, seat, thinking }: { g: GameState; seat: Seat; thinking: Seat | null }) {
  const hand = g.hands[seat] ?? [];
  const sitsOut = g.sittingOut === seat;
  const active = g.turn === seat;
  return (
    <div class={`seat seat-${POS[seat]}${active ? ' active' : ''}${thinking === seat ? ' seat-thinking' : ''}`}>
      <div class="seat-name">
        {SEAT_NAMES[seat]} {seatBadges(g, seat)} {bidBubble(g, seat)}
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
  onQuestion?: ((play: number) => void) | undefined;
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
          <Domino id={p.domino} orientation="h" className="trick-dom" />
          {onQuestion && !gathering && <button class="play-question" type="button" aria-label={`Save a question about ${p.seat === HUMAN_SEAT ? 'your' : SEAT_NAMES[p.seat] + '’s'} ${p.domino.split('').join('–')}`} onClick={() => onQuestion(i)}>?</button>}
          {p.seat === leader && (
            <span class="led-tag">{p.seat === HUMAN_SEAT ? 'You' : SEAT_NAMES[p.seat]} led</span>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
