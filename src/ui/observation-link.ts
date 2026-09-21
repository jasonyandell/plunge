import { playLocation } from '../engine/play-index';
/** A portable finished-hand observation. Reconstruct the position from the
 * replay; imported fields never enter a live player's information boundary. */
import { type GameState } from '../engine';
import { type FlagRecord, type NativeReceipt, requestKey } from '../ai/native';
import { reviewPosition, decisionStats } from '../ai/native-analysis';
import { decodeHand, encodeHand } from './share';
import { BUILD_ID } from './update';

export function observationUrl(g: GameState, ply: number, seed: number, note: string, alternative: number | null,
  receipt: NativeReceipt | null): string | null {
  const hand = encodeHand(g);
  if (!hand) return null;
  const payload = { v: 2, hand, ply, seed, note, alternative, receipt, build: BUILD_ID };
  return `${location.origin}${location.pathname}#q=${encodeURIComponent(JSON.stringify(payload))}`;
}

export function decodeObservation(hash: string): { game: GameState; flag: FlagRecord } | null {
  try {
    if (!hash.startsWith('#q=') || hash.length > 100_000) return null;
    const v = JSON.parse(decodeURIComponent(hash.slice(3))) as {
      v: number; hand: string; ply: number; seed: number; note: string; alternative: number | null; receipt: NativeReceipt | null;
    };
    if (v.v !== 2 || typeof v.hand !== 'string' || typeof v.note !== 'string' || v.note.length > 4000
      || !Number.isInteger(v.ply) || v.ply < 0 || v.ply > 27 || !Number.isInteger(v.seed) || v.seed < 0 || v.seed > 0xffffffff) return null;
    const game = decodeHand(v.hand);
    if (!game) return null;
    const loc=playLocation(game,v.ply);
    if (!loc) return null;
    const position = reviewPosition(game, loc, v.seed);
    if (!position || (v.alternative !== null && !position.legal.includes(v.alternative))) return null;
    if (v.receipt) {
      if (v.receipt.schema !== 'plunge-decision-v1' || !/^[a-f0-9]{64}$/.test(v.receipt.id)
        || requestKey(v.receipt.identity.request) !== requestKey(position.request)
        || v.receipt.response.choice !== position.played) return null;
      decisionStats(v.receipt.response, position.request, position.legal);
    }
    return { game, flag: { portable: true, id: 'portable', ply: v.ply, share_code: v.hand, played: position.played,
      alternative: v.alternative, note: v.note, request: position.request,
      receipt_id: v.receipt?.id ?? null, original_receipt: v.receipt ?? null } };
  } catch { return null; }
}
