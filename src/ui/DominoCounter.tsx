import { ALL_DOMINO_IDS, countValue, fromId, type GameState } from '../engine';
import { Domino, dominoAriaLabel } from './Domino';

/** Public plays only: never inspect anyone's hand, including a sitting-out partner. */
export function DominoCounter({ g }: { g: GameState }) {
  const played = new Set([
    ...g.tricks.flatMap(trick => trick.plays.map(play => play.domino)),
    ...g.currentTrick.map(play => play.domino),
  ]);
  const count = [...played].reduce((sum, id) => sum + countValue(fromId(id)), 0);

  return (
    <details class="domino-counter">
      <summary>Domino counter</summary>
      <div class="domino-counter-panel" role="region" aria-label="Public domino counter" tabIndex={0}>
        <p class="domino-counter-totals">
          <span><strong>{played.size} / {ALL_DOMINO_IDS.length}</strong> dominoes played</span>
          <span><strong>{count} / 35</strong> count points played</span>
        </p>
        <p class="domino-counter-note">✓ Played · Count points exclude trick points.</p>
        <ul class="domino-counter-grid" aria-label="All dominoes">
          {ALL_DOMINO_IDS.map(id => (
            <li key={id}>
              <div class={`domino-counter-tile${played.has(id) ? ' is-played' : ''}`}
                role="img" aria-label={`${dominoAriaLabel(id)}, ${played.has(id) ? 'played' : 'not played'}`}>
                <div aria-hidden="true">
                  <Domino id={id} orientation="h" />
                  {played.has(id) && <span class="domino-counter-check">✓</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {g.sittingOut !== null && <p class="domino-counter-note">Nel-O: the sitting-out hand stays unplayed.</p>}
      </div>
    </details>
  );
}
