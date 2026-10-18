import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState } from '../engine';
import { player, playerId, playerLabel, playerVersion, SELECTABLE_PLAYERS, type PlayerId } from '../ai/players';
import { planPlayerChange } from '../ai/player-change';

/** All model controls put the consequence beside the decision, before committing it. */
export function PlayerPicker({ selected, game, sessionId, family = false, disabled = false, onChoose }: {
  selected: unknown; game: GameState | null; sessionId: string; family?: boolean; disabled?: boolean;
  onChoose: (next: PlayerId, confirmed: boolean) => void;
}) {
  const current = playerId(selected), [pending, setPending] = useState<{ player: PlayerId; from: PlayerId; sessionId: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const cancel = () => { dialog.current?.close(); setPending(null); trigger.current?.focus(); };
  useEffect(() => { setPending(null); }, [current, sessionId]);
  useEffect(() => {
    if (pending) dialog.current?.showModal();
    return () => dialog.current?.close();
  }, [pending]);
  const choose = (next: PlayerId) => {
    const plan = planPlayerChange(current, next, game);
    if (plan.kind === 'unchanged') return;
    if (plan.endsGame) setPending({ player: next, from: current, sessionId }); else onChoose(next, false);
  };
  const options = current === 'native-l1' ? [current, ...SELECTABLE_PLAYERS] : SELECTABLE_PLAYERS;
  return <div class="player-picker">
    <p class="setting-hint">{playerVersion(current)}. {player(current).description}{!player(current).capabilities.nello && ' Walt covers Nel-O.'}</p>
    <div class="seg" role="radiogroup" aria-label="Computer player">
      {options.map(id => <button key={id} type="button" role="radio" class={`seg-btn${id === current ? ' on' : ''}`}
        aria-checked={id === current} disabled={disabled} onClick={e => { trigger.current = e.currentTarget; choose(id); }}>{playerLabel(id)}</button>)}
    </div>
    {pending && <dialog ref={dialog} class="player-change-dialog" aria-labelledby="player-change-title" onCancel={e => { e.preventDefault(); cancel(); }}>
      <h2 id="player-change-title" class="sheet-title">Switch to {playerLabel(pending.player)}?</h2>
      <p>{family
        ? 'This will end the current game for everyone and return the table to the lobby. Everyone present must agree before anything changes.'
        : 'This will end your current game and return you to home. You won’t be able to resume this game.'}</p>
      <p class="setting-hint">Your saved history and hints stay available.</p>
      <p>{player(pending.player).description}{!player(pending.player).capabilities.nello && ' Walt covers Nel-O.'}</p>
      <div class="player-change-actions">
        <button type="button" class="big-btn secondary" autoFocus onClick={cancel}>Keep {playerLabel(current)}</button>
        <button type="button" class="big-btn" disabled={disabled} onClick={() => {
          if (pending.sessionId === sessionId && pending.from === current) onChoose(pending.player, true);
          setPending(null);
        }}>
          {family ? 'Ask to end game and switch' : 'End game and switch'}
        </button>
      </div>
    </dialog>}
  </div>;
}
