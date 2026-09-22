import { useState } from 'preact/hooks';
import { legalDominoes, type DominoId, type GameState, type CompletedTrick } from '../engine';
import { Domino, dominoAriaLabel } from './Domino';
import { HUMAN_SEAT, SEAT_NAMES, type AppEvent } from './store';

/** Selection belongs to one exact position; a later turn cannot reuse it. */
export function selectedForPosition(g: GameState, selection: { game: GameState; id: DominoId } | null): DominoId | null {
  return selection?.game === g && g.turn === HUMAN_SEAT && g.phase === 'playing'
    && legalDominoes(g).includes(selection.id) ? selection.id : null;
}

export function ComfortHand({ g, canPlay, dispatch, completed }: {
  g: GameState; canPlay: boolean; completed: CompletedTrick | null; dispatch: (e: AppEvent) => void;
}) {
  const [selection, select] = useState<{ game: GameState; id: DominoId } | null>(null);
  const selected = canPlay ? selectedForPosition(g, selection) : null;
  const held = new Set(g.hands[HUMAN_SEAT]);
  const legal = new Set(canPlay ? legalDominoes(g) : []);
  return <>
    <div class="comfort-hand" role="group" aria-label="Your hand, fixed positions">
      {(g.dealt[HUMAN_SEAT] ?? []).map(id => <div class="comfort-slot" key={id}>
        {held.has(id) ? <Domino id={id} orientation={g.phase === 'bidding' || g.phase === 'declaring' ? 'h' : 'v'} state={canPlay ? legal.has(id) ? 'legal' : 'illegal' : 'idle'}
          selected={selected === id} className={selected === id ? 'comfort-selected' : ''}
          onTap={() => select({ game: g, id })} />
          : <span class="comfort-empty" aria-label={`${dominoAriaLabel(id)}, already played`}>Played</span>}
      </div>)}
    </div>
    {g.phase === 'playing' && <div class="comfort-play">
      <p role="status">{completed ? `${completed.winner === HUMAN_SEAT ? 'You won' : `${SEAT_NAMES[completed.winner]} won`} the trick · ${completed.points} ${completed.points === 1 ? 'point' : 'points'}. Continue when you’re ready.` : selected ? `Selected ${selected.split('').join('–')}. Tap another to change.`
        : canPlay ? 'Choose a lit domino. Nothing plays until you confirm.' : 'Your dominoes stay in the same places.'}</p>
      <button type="button" class="big-btn" disabled={!selected && !completed} onClick={() => {
        if (completed) dispatch({ type: 'trick-shown' });
        else if (selected) dispatch({ type: 'human', action: { type: 'play', domino: selected }, expectedGame: g });
      }}>{completed ? 'Continue' : selected ? `Play ${selected.split('').join('–')}` : 'Select a domino to play'}</button>
    </div>}
  </>;
}
