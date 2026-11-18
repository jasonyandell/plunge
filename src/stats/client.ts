import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import { deviceId } from '../history/stats-sync';
import { listHands } from '../history/legacy';
import type { SavedHand } from './model';

interface Browse { account: string; family: boolean; items: SavedHand[]; next: string | null }
export interface StatsData { account: string | null; family: boolean; hands: SavedHand[]; notice: string }
export async function loadStats(scope: 'mine' | 'family', signal: AbortSignal): Promise<StatsData> {
  let local: SavedHand[] = [], notice = '';
  if (scope === 'mine') try {
    const [records, device] = await Promise.all([listHands(), deviceId()]);
    local = records.map(record => ({ id: `${device}:${record.id}`, record, players: [{ seat: 0, name: 'You' }] }));
  } catch { notice = 'This browser could not open its local stats. '; }
  if (QUESTIONS_LOCAL_ONLY) return { account: null, family: false, hands: local, notice: `${notice}This preview shows device stats only. Try the demo to explore sample hands.` };
  try {
    let before: string | null = null, account: string | null = null, family = false;
    const hands = new Map(local.map(h => [h.id, h]));
    do {
      const response = await fetch(`/api/stats/browse?scope=${scope}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
        { credentials: 'same-origin', cache: 'no-store', signal });
      if (response.status === 401 && scope === 'mine') return { account: null, family: false, hands: local, notice: `${notice}Device stats. Sign in to see your other devices and family hands.` };
      if (!response.ok) throw new Error('Account stats could not load.');
      const page = await response.json() as Browse;
      if (account && account !== page.account) throw new Error('Account changed.');
      account = page.account; family = page.family;
      for (const hand of page.items) hands.set(hand.id, { ...hand, remote: true });
      if (page.next === before && page.next) throw new Error('Hand list did not advance.');
      before = page.next;
    } while (before);
    return { account, family, hands: [...hands.values()], notice };
  } catch (e) {
    if (signal.aborted) throw e;
    if (scope === 'family') throw new Error('Family hands could not load. Sign in with family access and try again.');
    return { account: null, family: false, hands: local, notice: `${notice}Account stats are unavailable. Showing device hands and device-only practice.` };
  }
}
