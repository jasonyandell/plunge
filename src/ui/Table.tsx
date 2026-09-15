/**
 * The table screen. Renders purely from GameState — no duplicated game state.
 *
 * Seating (clockwise = ascending seats): you (0) at the bottom, Earl (1) to
 * your left, Gran (2) — your partner — across the top, Ruby (3) to your right.
 *
 * Layout sanity (no fixed heights that clip; flex columns with min-height 0):
 *   360×640 — status 48 + partner row ~78 + middle flex ~390 + hand ~124
 *   390×844 — same bands, middle grows; hand tiles cap at 58px wide.
 */

import { useEffect, useState } from 'preact/hooks';
import type { CompletedTrick, GameState, PlayRecord, Seat } from '../engine';
import { legalDominoes } from '../engine';
import { Domino } from './Domino';
import { Tally } from './Tally';
import type { AppEvent, AppState } from './store';
import {
  HUMAN_SEAT, SEAT_NAMES, bidLabel, contractLabel, ledChip, thinkingCopy, trumpChip,
} from './store';
import { BidSheet, DeclareSheet, GameOverSheet, HandOverSheet } from './sheets';
import { TrickHistory } from './TrickHistory';
import { NativeReview } from './NativeReview';
import './table.css';

const POS: readonly string[] = ['bottom', 'left', 'top', 'right'];

interface TableProps {
  app: AppState;
  dispatch: (e: AppEvent) => void;
  /** Seat whose slow AI think is in flight (walt solving) — shows a note. */
  thinking?: Seat | null;
}

export function Table({ app, dispatch, thinking = null }: TableProps) {
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
        />
      )}
      <div class="felt">
        <OpponentTop g={g} />
        <div class="middle">
          <OpponentSide g={g} seat={1} />
          <TrickArea
            g={g}
            plays={trickPlays}
            winner={trickWinner}
            gathering={showingLast}
            thinking={thinking}
          />
          <OpponentSide g={g} seat={3} />
        </div>
        <div class="hand-area">
          <p class={`hand-caption${humanTurn && !showingLast ? ' your-turn' : ''}`} role="status">
            {humanTurn && !showingLast
              ? g.currentTrick.length === 0 ? 'Your turn to lead' : 'Your turn'
              : 'Your hand'}
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
            receipts={scenario ? {} : app.nativeReceipts} initialFlag={app.scenarioFlag} />
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

/** Slim bar under the status strip: trump + led-suit chips, trick history. */
function InfoBar({
  g,
  plays,
  open,
  onToggle,
}: {
  g: GameState;
  plays: readonly PlayRecord[];
  open: boolean;
  onToggle: () => void;
}) {
  const trump = trumpChip(g);
  const led = ledChip(g, plays);
  const n = g.tricks.length;
  return (
    <div class="info-wrap">
      <div class="info-bar">
        {trump && <span class="chip chip-trump">{trump}</span>}
        {led && <span class="chip chip-led">led: {led}</span>}
        <span class="info-spacer" />
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
      {open && n > 0 && <TrickHistory g={g} />}
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

function OpponentTop({ g }: { g: GameState }) {
  const seat: Seat = 2;
  const hand = g.hands[seat] ?? [];
  const sitsOut = g.sittingOut === seat;
  const active = g.turn === seat;
  return (
    <div class={`seat seat-top${active ? ' active' : ''}`}>
      <div class="seat-name">
        Gran <span class="seat-tag">(your partner)</span> {seatBadges(g, seat)} {bidBubble(g, seat)}
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

function OpponentSide({ g, seat }: { g: GameState; seat: Seat }) {
  const hand = g.hands[seat] ?? [];
  const sitsOut = g.sittingOut === seat;
  const active = g.turn === seat;
  return (
    <div class={`seat seat-${POS[seat]}${active ? ' active' : ''}`}>
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
}: {
  g: GameState;
  plays: readonly PlayRecord[];
  winner: Seat | null;
  gathering: boolean;
  thinking: Seat | null;
}) {
  const leader = plays[0]?.seat ?? null;
  const ledWords = ledChip(g, plays);
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
          {thinkingCopy(thinking)}
          <span class="think-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>
      )}
      <div class={`trick-plays${gathering && winner !== null ? ` gather-${POS[winner]}` : ''}`}>
      {plays.map((p) => (
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
          {p.seat === leader && (
            <span class="led-tag">{ledWords ? `led ${ledWords}` : 'led'}</span>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
