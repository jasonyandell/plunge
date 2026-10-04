/**
 * The table's presentation pieces, shared by the live game (Table.tsx) and
 * hand replay (HistoryReview.tsx). Pure functions of a GameState — no hooks,
 * no dispatch — so a replay can render a detached position on the same felt.
 *
 * Seating never moves (clockwise = ascending seats): you (0) at the bottom,
 * Earl (1) left, Gran (2) — your partner — across the top, Ruby (3) right.
 * A seat's tiles are face down unless `faceUp` says that hand may be seen.
 */
import type { ComponentChildren } from 'preact';
import type { GameState, PlayRecord, Seat } from '../engine';
import { playIndex } from '../engine/play-index';
import { Domino } from './Domino';
import { Tally } from './Tally';
import { HUMAN_SEAT, SEAT_NAMES, bidLabel, contractLabel, declLabel, ledChip, trumpChip } from './store';
import { TrickHistory } from './TrickHistory';

export const POS: readonly string[] = ['bottom', 'left', 'top', 'right'];

/** Which seats' tiles are shown face up. The live game shows none here. */
export type FaceUp = (seat: Seat) => boolean;
const NONE: FaceUp = () => false;

export function StatusStrip({ g, onMenu }: { g: GameState; onMenu?: (() => void) | undefined }) {
  return (
    <header class="status">
      {onMenu && (
        <button
          type="button"
          class="menu-btn"
          aria-label="Back to home"
          onClick={onMenu}
        >
          &#9776;
        </button>
      )}
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

export function statusLine(g: GameState): string {
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
export function InfoBar({
  g,
  plays,
  open,
  onToggle,
  onQuestion,
  footer,
}: {
  g: GameState;
  plays: readonly PlayRecord[];
  open: boolean;
  onToggle: () => void;
  onQuestion?: ((ply: number, target: HTMLElement) => void) | undefined;
  /** Extra content at the end of the open trick history. */
  footer?: ComponentChildren;
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
      {open && n > 0 && <>{onQuestion && <p class="question-history-hint">Curious about a move? Tap its domino.</p>}<TrickHistory g={g} actionLabel="Why this move?" footer={footer} onTapPlay={onQuestion ? (t, p, target) => onQuestion(playIndex(g,t,p), target) : undefined} /></>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function bidBubble(g: GameState, seat: Seat) {
  if (g.phase !== 'bidding' && g.phase !== 'declaring') return null;
  const sb = g.bids.find((b) => b.seat === seat);
  if (!sb) {
    return g.phase === 'bidding' && g.turn === seat ? (
      <span class="bubble thinking">&hellip;</span>
    ) : null;
  }
  return <span class={`bubble${sb.bid.kind === 'pass' ? ' pass' : ''}`}>{bidLabel(sb.bid)}</span>;
}

export function seatBadges(g: GameState, seat: Seat) {
  return (
    <>
      {g.shaker === seat && <span class="badge shaker" title="Shook this hand">&#9860;</span>}
      {g.declarer === seat && g.phase !== 'bidding' && <span class="badge decl">bid</span>}
    </>
  );
}

export function OpponentTop({ g, thinking, faceUp = NONE }: { g: GameState; thinking: Seat | null; faceUp?: FaceUp }) {
  const seat: Seat = 2;
  const hand = g.hands[seat] ?? [];
  const sitsOut = g.sittingOut === seat;
  const active = g.turn === seat;
  const up = faceUp(seat);
  return (
    <div class={`seat seat-top${active ? ' active' : ''}${thinking === seat ? ' seat-thinking' : ''}`}>
      <div class="seat-name">
        Gran <span class="seat-tag">Your partner</span> {seatBadges(g, seat)} {bidBubble(g, seat)}
      </div>
      <div class={`mini-row${sitsOut ? ' sitting' : ''}${up ? ' face-up' : ''}`} aria-label={up ? 'Gran’s hand, face up' : undefined}>
        {hand.map((id) => (
          up ? <Domino key={id} id={id} orientation="v" className="mini-v" />
            : <Domino key={id} faceDown orientation="v" className="mini-v" />
        ))}
      </div>
      {sitsOut && <div class="sit-note">sitting this one out</div>}
    </div>
  );
}

export function OpponentSide({ g, seat, thinking, faceUp = NONE }: { g: GameState; seat: Seat; thinking: Seat | null; faceUp?: FaceUp }) {
  const hand = g.hands[seat] ?? [];
  const sitsOut = g.sittingOut === seat;
  const active = g.turn === seat;
  const up = faceUp(seat);
  return (
    <div class={`seat seat-${POS[seat]}${active ? ' active' : ''}${thinking === seat ? ' seat-thinking' : ''}`}>
      <div class="seat-name">
        {SEAT_NAMES[seat]} {seatBadges(g, seat)} {bidBubble(g, seat)}
      </div>
      <div class={`mini-col${sitsOut ? ' sitting' : ''}${up ? ' face-up' : ''}`} aria-label={up ? `${SEAT_NAMES[seat]}’s hand, face up` : undefined}>
        {hand.map((id) => (
          up ? <Domino key={id} id={id} orientation="h" className="mini-h" />
            : <Domino key={id} faceDown orientation="h" className="mini-h" />
        ))}
      </div>
      {sitsOut && <div class="sit-note">sitting out</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function TrickArea({
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

// ---------------------------------------------------------------------------

/**
 * The felt: Gran across, Earl and Ruby at the sides, the trick between them,
 * and `children` (the bottom seat's hand area) underneath.
 */
export function Felt({
  g, plays, winner, gathering, thinking, onQuestion, faceUp = NONE, className, banner, children,
}: {
  g: GameState;
  plays: readonly PlayRecord[];
  winner: Seat | null;
  gathering: boolean;
  thinking: Seat | null;
  onQuestion?: ((play: number, target: HTMLElement) => void) | undefined;
  faceUp?: FaceUp;
  className?: string | undefined;
  /** Shown across the top of the felt (e.g. a hindsight warning). */
  banner?: ComponentChildren;
  children?: ComponentChildren;
}) {
  return (
    <div class={className ? `felt ${className}` : 'felt'}>
      {banner}
      <OpponentTop g={g} thinking={thinking} faceUp={faceUp} />
      <div class="middle">
        <OpponentSide g={g} seat={1} thinking={thinking} faceUp={faceUp} />
        <TrickArea
          g={g}
          plays={plays}
          winner={winner}
          gathering={gathering}
          thinking={thinking}
          onQuestion={onQuestion}
        />
        <OpponentSide g={g} seat={3} thinking={thinking} faceUp={faceUp} />
      </div>
      {children}
    </div>
  );
}
