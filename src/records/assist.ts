/**
 * Hint displays are announced on the window so any hint surface can report
 * one without threading the store through it. App.tsx records each into the
 * hand journal as a fact; no stat ever reads it.
 */
import type { HintEvidence } from '../questions/hint-evidence';

export const HINT_SHOWN = 'plunge-hint-shown';

export function announceHint(evidence: HintEvidence): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<HintEvidence>(HINT_SHOWN, { detail: evidence }));
}
