import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import { deviceId } from '../history/stats-sync';
import { listHands } from '../history/legacy';
import type { SavedHand, StatsHand } from './model';
import { ghostProgress, actionKey, type ReplayAttempt } from './ghost';
import type { Action, Seat } from '../engine';

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
    return { account: null, family: false, hands: local, notice: `${notice}Account stats are unavailable. Showing device hands and device-only replay scores.` };
  }
}

export interface AttemptBook {
  label: string;
  list(): Promise<ReplayAttempt[]>;
  start(): Promise<ReplayAttempt[]>;
  save(id: string, choices: Action[]): Promise<ReplayAttempt[]>;
}
export function attemptBook(hand: StatsHand, seat: Seat, account: string | null, demo: boolean): AttemptBook {
  if (hand.remote && account && !demo && !QUESTIONS_LOCAL_ONLY) {
    const url = `/api/stats/replays?hand=${encodeURIComponent(hand.id)}&seat=${seat}`;
    const request = async (method: string, body?: unknown) => {
      const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Replay scores could not be saved. Retry to resume.');
      if (data.account !== account) throw new Error('Your account changed. Reopen stats.');
      return data.attempts as ReplayAttempt[];
    };
    return { label: 'Replay scores saved to your account', list: () => request('GET'),
      start: () => request('POST', { account, id: crypto.randomUUID() }),
      save: (id, choices) => request('PUT', { account, id, choices }) };
  }
  const key = JSON.stringify([demo ? 'demo' : 'device', hand.id, seat, hand.record.code]);
  const run = async (change?: (attempts: ReplayAttempt[]) => ReplayAttempt[]): Promise<ReplayAttempt[]> => {
    const db = await localDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('attempts', change ? 'readwrite' : 'readonly'), store = tx.objectStore('attempts'), request = store.get(key);
      let saved: ReplayAttempt[] = [], failure: unknown;
      request.onsuccess = () => {
        try { saved = change ? change(request.result ?? []) : request.result ?? []; if (change) store.put(saved, key); }
        catch (e) { failure = e; tx.abort(); }
      };
      tx.oncomplete = () => resolve(saved);
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Replay scores could not be saved on this device.'));
    });
  };
  return { label: demo ? 'Demo replay scores · separate from your real stats' : 'Replay scores on this device only', list: () => run(),
    start: () => run(attempts => {
      if (attempts.some(a => !a.done)) return attempts;
      const p = ghostProgress(hand.game, seat, []);
      return [...attempts, { id: crypto.randomUUID(), choices: [], matched: 0, total: p.total, done: p.done }];
    }),
    save: (id, choices) => run(attempts => {
      const index = attempts.findIndex(a => a.id === id), old = attempts[index];
      if (!old || choices.length < old.choices.length || choices.length > old.choices.length + 1
        || old.choices.some((a, i) => actionKey(a) !== actionKey(choices[i]!)) || (old.done && choices.length !== old.choices.length)) {
        throw new Error('Another tab changed this attempt. Refresh to resume.');
      }
      const p = ghostProgress(hand.game, seat, choices);
      return attempts.map((a, i) => i === index ? { ...a, choices, matched: p.matched, total: p.total, done: p.done } : a);
    }) };
}
let opened: Promise<IDBDatabase> | undefined;
function localDatabase(): Promise<IDBDatabase> {
  return opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('plunge-replay-practice', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('attempts');
    request.onerror = () => { opened = undefined; reject(request.error); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened = undefined; }; resolve(request.result); };
  });
}
