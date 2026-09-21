import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState } from '../engine';
import type { HintEvidence } from '../questions/hint-evidence';
import { saveHintQuestion } from '../questions/client';

/** Same notebook as played-domino questions, capturing before an action is taken. */
export function SaveHint({ g, sessionId, evidence, onSaved, disabled = false }: {
  g: GameState; sessionId: string; evidence: HintEvidence; onSaved: (id: string) => void; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), saving = useRef(false);
  useEffect(() => () => { alive.current = false; }, []);
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const saved = await saveHintQuestion(g, sessionId, evidence);
      if (alive.current) onSaved(saved.question.id);
    } catch { if (alive.current) setError('The hint couldn’t be saved. Please try again.'); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  return <div class="hint-question">
    <button type="button" class="text-btn" disabled={disabled || busy} onClick={() => void save()}>
      {busy ? 'Saving hint…' : 'Why this hint?'}
    </button>
    <span>Save it, add a note, or share.</span>
    {error && <p role="alert">{error}</p>}
  </div>;
}
