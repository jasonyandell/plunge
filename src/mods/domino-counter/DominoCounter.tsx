import {
  ALL_DOMINO_IDS, CALLED_SUIT, PIPS, countValue, follows, fromId, rank,
  type GameState, type LedSuit, type TrickRules,
} from '../../engine';
import { Domino, dominoAriaLabel, PIP_SUIT_NAMES } from '../../kernel/mod-api';
import './counter.css';

/** Group by suits a tile can follow, not just the suit it would lead. */
export function counterSuits(rules: TrickRules | null) {
  if (!rules) return [{ label: 'All dominoes', ids: [...ALL_DOMINO_IDS] }];
  const suits: { suit: LedSuit; label: string }[] = [];
  if (rules.called.kind !== 'none') {
    const name = rules.called.kind === 'doubles' ? 'Doubles' : PIP_SUIT_NAMES[rules.called.pip];
    suits.push({ suit: CALLED_SUIT, label: `${name}${rules.powered ? ' · Trump' : ' · Own suit'}` });
  }
  for (const pip of [...PIPS].reverse()) {
    if (rules.called.kind === 'pip' && rules.called.pip === pip) continue;
    suits.push({ suit: pip, label: PIP_SUIT_NAMES[pip]! });
  }
  return suits.map(({ suit, label }) => ({
    label,
    ids: ALL_DOMINO_IDS.filter(id => follows(fromId(id), suit, rules))
      .sort((a, b) => rank(fromId(b), rules) - rank(fromId(a), rules)),
  }));
}

/** Public plays only: never inspect anyone's hand, including a sitting-out partner. */
export function DominoCounter({ g }: { g: GameState }) {
  if (g.phase === 'bidding' || g.phase === 'declaring') return null;
  const played = new Set([
    ...g.tricks.flatMap(trick => trick.plays.map(play => play.domino)),
    ...g.currentTrick.map(play => play.domino),
  ]);
  const count = [...played].reduce((sum, id) => sum + countValue(fromId(id)), 0);

  return (
    <details class="domino-counter">
      <summary>Show suits · Domino counter</summary>
      <div class="domino-counter-panel" role="region" aria-label="Public domino counter" tabIndex={0}>
        <p class="domino-counter-totals">
          <span><strong>{played.size} / {ALL_DOMINO_IDS.length}</strong> dominoes played</span>
          <span><strong>{count} / 35</strong> count points played</span>
        </p>
        <p class="domino-counter-note">✓ Played · Unplayed includes your hand.</p>
        <p class="domino-counter-note">{g.rules
          ? 'Tiles appear in each suit they can follow, strongest first.'
          : 'Sevens has no suits; all dominoes are shown.'}</p>
        {counterSuits(g.rules).map(({ label, ids }) => (
          <section class="domino-counter-suit" key={label} aria-label={label}>
            <h3><span>{label}</span><span>{ids.filter(id => !played.has(id)).length} / {ids.length} unplayed</span></h3>
            <ul class="domino-counter-grid" aria-label={`${label} dominoes`}>
              {ids.map(id => (
                <li key={id}>
                  <div class={`domino-counter-tile${played.has(id) ? ' is-played' : ''}`}
                    role="img" aria-label={`${dominoAriaLabel(id)}, ${played.has(id) ? 'played' : 'unplayed'}`}>
                    <div aria-hidden="true">
                      <Domino id={id} orientation="h" />
                      {played.has(id) && <span class="domino-counter-check">✓</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p class="domino-counter-note">Overall totals count each domino once. Count points exclude trick points.</p>
        {g.sittingOut !== null && <p class="domino-counter-note">Nel-O: the sitting-out hand stays unplayed.</p>}
      </div>
    </details>
  );
}
