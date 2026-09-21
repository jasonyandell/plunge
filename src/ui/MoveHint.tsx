import { useEffect, useRef, useState } from 'preact/hooks';
import { countValue, fromId, trickWinnerIndex, type GameState } from '../engine';
import { requestTile } from '../ai/native';
import { getHint, hintExplanation, type Hint } from '../ai/hint';
import { Domino } from './Domino';
import { SaveHint } from './SaveHint';
import { MoveScores } from './MoveScores';
import { SEAT_NAMES, ledChip, trumpChip } from './store';
import './hint.css';

/** Public mechanics, kept separate from the sampled explanation. */
export function hintTrickEffect(g: GameState, tile: number): string {
  if (!g.rules || !g.currentTrick.length) return 'You’re choosing the lead.';
  const domino = requestTile(tile), plays = [...g.currentTrick, { seat: 0 as const, domino }];
  const winner = plays[trickWinnerIndex(plays, g.rules)]!.seat;
  const who = winner === 0 ? 'you' : SEAT_NAMES[winner];
  const fact = plays.length === 4 ? `With this play, ${who} ${winner === 0 ? 'win' : 'wins'} this trick.`
    : `With this play, ${who} ${winner === 0 ? 'are' : 'is'} winning for now; ${4 - plays.length} still to play.`;
  const count = countValue(fromId(domino));
  return fact + (count ? ` It adds ${count} count points to the trick.` : '');
}

/** Parent keys this component by position. Closing or leaving cancels its worker. */
export function MoveHint({ g, sessionId, onQuestion }: { g: GameState; sessionId: string; onQuestion: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const close = (): void => {
    controller.current?.abort(); controller.current = null;
    setBusy(false); setOpen(false); button.current?.focus();
  };
  const inspect = async (worlds: 40 | 160): Promise<void> => {
    if (controller.current) return;
    const active = new AbortController(); controller.current = active;
    setBusy(true); setError(false);
    try {
      const result = await getHint(g, sessionId, worlds, active.signal);
      if (controller.current === active) {
        // A deeper timeout must not erase a previous measured hint.
        if (result.choice !== null || !hint) setHint(result);
        if (result.choice === null) setError(true);
      }
    } catch { if (controller.current === active) setError(true); }
    finally { if (controller.current === active) { controller.current = null; setBusy(false); } }
  };
  const tile = hint?.choice ?? null;
  const led = ledChip(g, g.currentTrick);
  return <>
    <button type="button" class="hint-button" ref={button} onClick={() => {
      setOpen(true); if (!hint || hint.choice === null) void inspect(40);
    }}>Get a hint</button>
    <dialog ref={dialog} class="hint-dialog" aria-labelledby="hint-title" onCancel={e => { e.preventDefault(); close(); }}>
      <header class="hint-header"><h2 id="hint-title">A hint from Walt</h2>
        <button type="button" class="hint-close" aria-label="Close hint" onClick={close}>×</button></header>
      <p class="hint-position">{trumpChip(g)}{led ? ` · Led: ${led}` : ''}</p>
      {tile !== null && <>
        <div class="hint-pick"><Domino id={requestTile(tile)} orientation="h" />
          <strong>{hint?.forced ? 'The only legal play' : `Walt suggests ${requestTile(tile).split('').join('–')}`}</strong></div>
        <p>{hintExplanation(hint!)}</p>
        {hint?.stats && hint.stats.worlds < hint.requestedWorlds && <p class="setting-hint">
          The full comparison didn’t finish. Showing the completed {hint.stats.worlds}-deal comparison.
        </p>}
        <p class="hint-fact">{hintTrickEffect(g, tile)}</p>
        {hint?.stats && <>
          <p class="setting-hint">This compares the whole hand, beyond the current trick. It’s a sampled estimate; small differences can come down to the sample.</p>
          <details class="disclosure"><summary>Compare your choices</summary>
            <MoveScores stats={hint.stats} selected={tile} selectionLabel="Suggested" />
            <p class="setting-hint">Hints use your hand and public plays. They compare the baseline player’s outcomes without the separate partner check.</p>
          </details>
        </>}
        {hint && <SaveHint g={g} sessionId={sessionId} disabled={busy} evidence={{ kind: 'move',
          requested_worlds: hint.requestedWorlds, choice: tile, forced: hint.forced, estimate: hint.estimate,
          explanation: hintExplanation(hint), context: hintTrickEffect(g, tile) }}
          onSaved={id => { close(); onQuestion(id); }} />}
      </>}
      {busy && <p role="status">Walt is comparing your options…</p>}
      {error && <p role="alert" class="native-warning">Walt couldn’t finish a new comparison. {tile !== null ? 'The previous hint is still shown.' : 'You can retry or keep playing.'}</p>}
      <div class="hint-actions">
        {!busy && error && <button type="button" class="big-btn secondary" onClick={() => void inspect(40)}>Try again</button>}
        {!busy && hint?.stats && hint.stats.worlds < 160 && <button type="button" class="big-btn secondary" onClick={() => void inspect(160)}>Think deeper</button>}
        <button type="button" class="big-btn" onClick={close}>{busy ? 'Cancel hint' : 'Back to my hand'}</button>
      </div>
    </dialog>
  </>;
}
