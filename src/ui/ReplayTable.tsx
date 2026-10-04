/**
 * A replayed position on the live game's own felt (TableFelt.tsx). Pure: it
 * renders a detached GameState and reports a chosen legal action — it never
 * sees the app store or the game in progress.
 *
 * Seats never move: you stay at the bottom, Earl left, Gran across, Ruby
 * right. The hand area shows whoever acts at this point, labelled by name,
 * and only that seat's tiles are face up — unless hindsight is switched on,
 * which turns every hand face up under a warning across the felt.
 */
import { type Action, type GameState, type PlayRecord, type Seat, legalActions } from '../engine';
import { actionLabel } from '../review/describe';
import { actorAt, sameAction } from '../review/steps';
import { Domino } from './Domino';
import { HUMAN_SEAT, SEAT_NAMES } from './store';
import { Felt, POS, bidBubble, seatBadges } from './TableFelt';
import './table.css';
import './hint.css';

const SEAT_PLACE = ['bottom', 'left seat', 'across', 'right seat'] as const;
const pips = (id: string): string => `${id[0]}–${id[1]}`;

/**
 * The trick on the felt: the one in progress, as at the live table. Once the
 * hand is over the last trick stays, marked with its winner.
 */
export function shownTrick(g: GameState): { plays: readonly PlayRecord[]; winner: Seat | null } {
  const last = g.tricks[g.tricks.length - 1];
  if (g.currentTrick.length || !last || g.phase === 'playing') return { plays: g.currentTrick, winner: null };
  return { plays: last.plays, winner: last.winner };
}

export interface ReplayTableProps {
  g: GameState;
  /** The move actually made from here, outlined; null on a what-if branch. */
  actual: Action | null;
  /** Hindsight: every hand face up. Off by default. */
  reveal: boolean;
  onReveal: (on: boolean) => void;
  onChoose: (a: Action) => void;
  /** Shown when nobody is to act (end of hand, record stops, branch done). */
  endNote: string;
}

export function ReplayTable({ g, actual, reveal, onReveal, onChoose, endNote }: ReplayTableProps) {
  const actor = actorAt(g);
  // Whose eyes the hand area uses: the acting seat, or you once play stops.
  const viewer: Seat = actor ?? HUMAN_SEAT;
  const { plays, winner } = shownTrick(g);
  return (
    <Felt
      g={g}
      plays={plays}
      winner={winner}
      gathering={false}
      thinking={null}
      faceUp={s => reveal || s === viewer}
      className={reveal ? 'replay-felt is-hindsight' : 'replay-felt'}
      banner={reveal && (
        <div class="replay-hindsight" role="note">
          <span><strong>Hindsight: all hands face up.</strong> Nobody at the table could see these.</span>
          <button type="button" class="replay-hindsight-off" onClick={() => onReveal(false)}>Hide</button>
        </div>
      )}
    >
      {viewer !== HUMAN_SEAT && <BottomSeat g={g} faceUp={reveal} />}
      <SeatHand g={g} seat={viewer} actor={actor} actual={actual} onChoose={onChoose} endNote={endNote} />
    </Felt>
  );
}

/** Your seat when someone else is acting: compact, face down unless hindsight. */
function BottomSeat({ g, faceUp }: { g: GameState; faceUp: boolean }) {
  const hand = g.hands[HUMAN_SEAT] ?? [];
  return (
    <div class={`seat seat-bottom replay-bottom${g.turn === HUMAN_SEAT ? ' active' : ''}`}>
      <div class="seat-name">You {seatBadges(g, HUMAN_SEAT)} {bidBubble(g, HUMAN_SEAT)}</div>
      <div class={`replay-bottom-row${g.sittingOut === HUMAN_SEAT ? ' sitting' : ''}${faceUp ? ' face-up' : ''}`}
        aria-label={faceUp ? 'Your hand, face up' : undefined}>
        {hand.map(id => faceUp
          ? <Domino key={id} id={id} orientation="h" className="mini-h" />
          : <Domino key={id} faceDown orientation="h" className="mini-h" />)}
      </div>
    </div>
  );
}

function SeatHand({ g, seat, actor, actual, onChoose, endNote }: {
  g: GameState; seat: Seat; actor: Seat | null; actual: Action | null; onChoose: (a: Action) => void; endNote: string;
}) {
  const you = seat === HUMAN_SEAT;
  const name = SEAT_NAMES[seat] ?? `Seat ${seat}`;
  const options = actor === null ? [] : legalActions(g);
  const isActual = (a: Action) => actual !== null && sameAction(a, actual);
  const verb = g.phase === 'bidding' ? 'bid' : g.phase === 'declaring' ? 'call trump' : g.currentTrick.length ? 'play' : 'lead';
  const hand = g.hands[seat] ?? [];
  const playing = actor !== null && g.phase === 'playing';
  return (
    <div class={`hand-area replay-hand seat-at-${POS[seat]}`}>
      <div class="hand-heading">
        <p class={`hand-caption${actor !== null ? ' your-turn' : ''}`} role="status">
          <strong class={you ? 'you-label' : 'you-label replay-seat-label'}>{name}</strong>
          <span>
            {actor === null ? endNote : `${you ? 'You' : name} to ${verb}`}
            {!you && <small class="replay-whose"> · {name}’s hand ({SEAT_PLACE[seat]})</small>}
          </span>
        </p>
      </div>
      {g.sittingOut === seat ? (
        <div class="hand sit-out">
          {hand.map(id => <Domino key={id} faceDown orientation="v" />)}
          <p class="sit-note">{you ? 'You sat' : `${name} sat`} this one out — Nel-O.</p>
        </div>
      ) : (
        <div class="hand" aria-label={you ? 'Your hand' : `${name}’s hand`}>
          {hand.map(id => {
            const a: Action = { type: 'play', domino: id };
            const legal = playing && options.some(o => sameAction(o, a));
            const tile = <Domino id={id} orientation="v" state={playing ? (legal ? 'legal' : 'illegal') : 'idle'}
              onTap={legal ? () => onChoose(a) : undefined} />;
            return playing && isActual(a)
              ? <span key={id} class="replay-tile is-actual">{tile}<span class="replay-tag" aria-hidden="true">actual</span></span>
              : <span key={id} class="replay-tile">{tile}</span>;
          })}
        </div>
      )}
      {playing && actual?.type === 'play' && <p class="replay-sr">The actual move was {pips(actual.domino)}. Tap it to replay, or tap another bright tile to try it.</p>}
      {actor !== null && g.phase !== 'playing' && (
        <div class="replay-calls" role="group" aria-label={`${you ? 'Your' : `${name}’s`} legal choices`}>
          {options.map(a => (
            <button type="button" key={actionLabel(a)} class={`replay-call${isActual(a) ? ' is-actual' : ''}`}
              aria-label={`${actionLabel(a)}${isActual(a) ? ' (the actual choice)' : ''}`} onClick={() => onChoose(a)}>
              {actionLabel(a).replace(' as trump', '')}{isActual(a) && <small> actual</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
