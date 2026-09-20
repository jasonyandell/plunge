/**
 * Portable hand links: a finished hand encoded as a short URL fragment so
 * anyone can send "it played weird here" and the recipient opens the exact
 * hand in review.
 *
 * Format (all printable, ~130 chars):
 *   v1 <preset c|t|f (Plunge forced-30)> <shaker 0-3> <dealt: 4 seats x 7 dominoes, "65"-style>
 *   "." <action tokens>
 * Action tokens are parsed by replay phase, so no separators are needed:
 *   bidding:   P pass · two digits points (30..41) · M/G/S/N + marks value
 *              (plain / plunge / splash / nello)
 *   declaring: D + (0-6 pip | 7 doubles | 9 no-trump | n nello | s sevens)
 *   playing:   two-char domino id
 *
 * Encoding REPLAYS the hand through the real engine and refuses to emit a
 * code that doesn't reproduce the original tricks and points; decoding is
 * the same replay, so a link cannot smuggle an illegal hand — any
 * inconsistency just yields null.
 */

import { type GameState } from '../engine';
import { encodeReplay, decodeReplay } from '../engine/replay-code';
export { presetOf } from '../engine/replay-code';

export function encodeHand(g: GameState): string | null {
  return g.phase === 'hand-over' || g.phase === 'game-over' ? encodeReplay(g) : null;
}
export function decodeHand(code: string): GameState | null {
  const g = decodeReplay(code);
  return g && (g.phase === 'hand-over' || g.phase === 'game-over') ? g : null;
}

/** The full shareable URL for a finished hand, or null. */
export function shareUrl(g: GameState): string | null {
  const code = encodeHand(g);
  if (!code) return null;
  return `${location.origin}${location.pathname}#r=${code}`;
}

/** Extract a share code from a location hash, if present. */
export function codeFromHash(hash: string): string | null {
  const m = /[#&]r=([A-Za-z0-9.]+)/.exec(hash);
  return m ? m[1]! : null;
}
