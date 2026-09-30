import { type GameState, type Seat } from '../engine';
import { Domino } from './Domino';
import { HUMAN_SEAT, SEAT_NAMES } from './store';
import './remaining-hands.css';

const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** Reveal only the unplayed tiles, once a played hand has ended. */
export function RemainingHands({ g }: { g: GameState }) {
  if ((g.phase !== 'hand-over' && g.phase !== 'game-over') || g.tricks.length === 0) return null;

  const hasRemaining = g.hands.some(hand => hand.length > 0);
  return (
    <section class="remaining-hands" aria-label="Remaining dominoes">
      <h3>Remaining dominoes</h3>
      <p class="remaining-note">{hasRemaining ? 'Still in hand when the hand ended.' : 'All dominoes were played.'}</p>
      {hasRemaining && SEATS.map(seat => {
        const name = seat === HUMAN_SEAT ? 'You' : SEAT_NAMES[seat];
        const hand = g.hands[seat] ?? [];
        return (
          <div class="remaining-seat" key={seat} role="group" aria-label={`${name}’s remaining dominoes`}>
            <div class="remaining-name">
              <strong>{name}</strong>
              {seat === 2 && <span>Your partner</span>}
              {seat === g.sittingOut && <span>Sat out</span>}
            </div>
            <div class="remaining-tiles">
              {hand.length > 0
                ? hand.map(id => <Domino key={id} id={id} orientation="v" />)
                : <span class="remaining-empty">None left</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
