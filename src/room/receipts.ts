import type { Seat } from '../engine';
import type { NativeReceipt } from '../ai/native';
import { digest, putReceipt } from '../ai/phone/records';
import type { RoomState } from './protocol';

/** A view projection has its own content id and points back to the unmodified original. */
export async function receiptForViewer(original: NativeReceipt, viewer: Seat): Promise<NativeReceipt> {
  if (!viewer) return original;
  const seat = (s: number) => (s - viewer + 4) % 4;
  const request = original.identity.request, response = original.response;
  const identity = { ...original.identity, request: { ...request, seat: seat(request.seat), bidder: seat(request.bidder),
    plays: request.plays.map((v, i) => i % 2 === 0 ? seat(v) : v) } };
  const projected = { ...response, leader: seat(response.leader),
    ...(response.inactive === undefined ? {} : { inactive: seat(response.inactive) }),
    points: viewer % 2 ? [response.points[1]!, response.points[0]!] : [...response.points] };
  const perspective = { sourceId: original.id, viewer };
  return { ...original, id: await digest({ identity, response: projected, perspective }), identity, response: projected, perspective };
}
export async function keepRoomReceipts(room: RoomState, viewer: Seat): Promise<Record<string, string>> {
  const ids = { ...room.nativeReceipts };
  for (const [key, original] of Object.entries(room.decisionReceipts ?? {})) {
    if (room.nativeReceipts[key] !== original.id) continue;
    const projected = await receiptForViewer(original, viewer);
    const saved = await putReceipt(original), viewSaved = viewer === 0 || await putReceipt(projected);
    if (!saved || !viewSaved) window.dispatchEvent(new Event('plunge-history-storage-error'));
    ids[key] = projected.id;
  }
  return ids;
}
