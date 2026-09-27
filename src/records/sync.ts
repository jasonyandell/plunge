/**
 * Best-effort upload of the device log. Hands never change, so an upload is
 * "store it unless already stored": retries, duplicates and racing tabs all
 * converge on one server row. Failure is silent to play; the next trigger
 * (load, timer, online, focus, a new hand) retries.
 */
import { ownerToken } from '../questions/storage';
import { markSynced, unsyncedHands } from './storage';

let flushing: Promise<void> | undefined;

export function syncHands(): Promise<void> {
  return flushing ??= (async () => {
    for (const record of await unsyncedHands()) {
      const r = await fetch(`/api/hands/${record.id}`, {
        method: 'PUT', cache: 'no-store', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Bearer ${await ownerToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hand: record }),
      });
      // A rejected record stays local and unsynced; it never blocks the rest.
      if (r.ok) await markSynced(record.id);
      else if (r.status >= 500 || r.status === 401) break;
    }
  })().catch(() => { /* Offline: retry on the next trigger. */ })
    .finally(() => { flushing = undefined; });
}
