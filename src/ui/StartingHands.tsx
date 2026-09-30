import { type GameState, type Seat } from '../engine';
import { Domino } from './Domino';
import { HUMAN_SEAT, SEAT_NAMES } from './store';
import './starting-hands.css';

const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** Reveal the original deal and distinguish tiles still held when play ended. */
export function StartingHands({ g }: { g: GameState }) {
  if ((g.phase !== 'hand-over' && g.phase !== 'game-over') || g.tricks.length === 0) return null;

  return (
    <section class="starting-hands" aria-label="Starting hands">
      <h3>Starting hands</h3>
      <p class="starting-note">All seven dominoes. “Held” means still in hand when play ended.</p>
      {SEATS.map(seat => {
        const name = seat === HUMAN_SEAT ? 'You' : SEAT_NAMES[seat];
        const held = new Set(g.hands[seat] ?? []);
        return (
          <div class="starting-seat" key={seat} role="group" aria-label={`${name}’s starting hand`}>
            <div class="starting-name">
              <strong>{name}</strong>
              {seat === 2 && <span>Your partner</span>}
              {seat === g.sittingOut && <span>Sat out</span>}
              <span class="starting-count">{held.size} left</span>
            </div>
            <div class="starting-tiles">
              {(g.dealt[seat] ?? []).map(id => (
                <div key={id} class={`starting-tile ${held.has(id) ? 'is-held' : 'is-played'}`}
                  role="group" aria-label={held.has(id) ? 'Still in hand' : 'Played'}>
                  <Domino id={id} orientation="v" />
                  <span class="starting-tile-status" aria-hidden="true">{held.has(id) ? 'Held' : 'Played'}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
