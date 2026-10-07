/** Browser side of the Family jam. The Worker in worker/jam.ts owns the GitHub side. */
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import { BUILD_ID } from '../ui/update';
import type { JamBoard, JamIdea, JamMessage, JamStatus, JamThread } from '../../worker/jam';
export type { JamBoard, JamIdea, JamMessage, JamStatus, JamThread };

/** PR previews have no jam secrets; they point at the live site instead. */
export const JAM_AVAILABLE: boolean = !QUESTIONS_LOCAL_ONLY;
export const JAM_LIVE_SITE = 'https://plunge.texas42.workers.dev';
const KEY = 'plunge:jam';
const API = '/api/jam';

export interface JamIdentity { name: string; passphrase: string }
export const STATUS_LABEL: Record<JamStatus, string> = {
  waiting: 'In the queue', working: 'Being built', preview: 'Ready to try', shipped: 'Shipped!', closed: 'Set aside',
};
export const STATUS_HINT: Record<JamStatus, string> = {
  waiting: 'The builder has it. Replies here reach it.', working: 'A change is being made. The preview appears here when it is ready.',
  preview: 'Tap “Try it” to play the preview. Say what you think below.', shipped: 'This is in the real game now. Reload Plunge to see it.',
  closed: 'Set aside for now. Ask about it below if you still want it.',
};

/** `#jam=<passphrase>` from an invite link. */
export function passphraseFromHash(hash: string): string | null {
  const match = /^#jam=(.+)$/.exec(hash);
  if (!match) return null;
  try { return decodeURIComponent(match[1]!).trim() || null; } catch { return null; }
}
export function jamRequested(search: string, hash: string): boolean {
  return new URLSearchParams(search).has('jam') || passphraseFromHash(hash) !== null;
}
export function jamInvite(passphrase: string, origin = location.origin, path = location.pathname): string {
  return `${origin}${path}?jam=1#jam=${encodeURIComponent(passphrase)}`;
}
export function loadIdentity(storage: Storage): JamIdentity | null {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? 'null') as JamIdentity | null;
    return value && typeof value.name === 'string' && typeof value.passphrase === 'string' && value.passphrase ? value : null;
  } catch { return null; }
}
export function saveIdentity(identity: JamIdentity, storage: Storage): void {
  try { storage.setItem(KEY, JSON.stringify(identity)); } catch { /* Private browsing still works for this visit. */ }
}
export function forgetIdentity(storage: Storage): void { try { storage.removeItem(KEY); } catch { /* nothing to forget */ } }
/** Enough for a replayable bug report, nothing that identifies the person. */
export function deviceNote(nav: Pick<Navigator, 'platform' | 'userAgent'> = navigator, width = innerWidth, height = innerHeight): string {
  const ua = nav.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'web';
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'browser';
  return `${device} · ${browser} · ${width}×${height} · build ${BUILD_ID.slice(0, 7)}`;
}

export class JamUnavailable extends Error {}
async function request<T>(path: string, passphrase: string, init: RequestInit = {}): Promise<T> {
  if (!JAM_AVAILABLE) throw new JamUnavailable('This preview has no jam board. Use the main Plunge site.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${encodeURIComponent(passphrase)}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API}${path}`, { ...init, headers, cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({})) as T & { error?: string; unavailable?: boolean };
  if (response.status === 503 && body.unavailable) throw new JamUnavailable(body.error ?? 'The jam board is not set up here.');
  if (response.status === 401) throw new Error('passphrase');
  if (!response.ok) throw new Error(body.error ?? 'The jam board is taking a breather. Try again in a minute.');
  return body;
}
export const fetchBoard = (passphrase: string) => request<JamBoard>('', passphrase);
export const fetchThread = (number: number, passphrase: string) => request<JamThread>(`/${number}`, passphrase);
export const submitIdea = (identity: JamIdentity, idea: string, device = deviceNote()) =>
  request<JamIdea>('', identity.passphrase, { method: 'POST', body: JSON.stringify({ name: identity.name, idea, device }) });
export const submitReply = (number: number, identity: JamIdentity, text: string) =>
  request<JamMessage>(`/${number}/replies`, identity.passphrase, { method: 'POST', body: JSON.stringify({ name: identity.name, text }) });

/** "Just now", "12 min ago", "Yesterday" — close enough for a kitchen table. */
export function whenLabel(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}
