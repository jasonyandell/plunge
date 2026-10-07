import { IDEA_ID, IDEA_TOKEN, LIVE_PLUNGE } from './model';
import { BUILD_ID } from '../ui/update';
export const newId = () => crypto.randomUUID().replaceAll('-', '');
export const TOKEN_KEY = 'plunge:ideas-invite';
export function inviteToken(value: string): string | null {
  const raw = value.trim();
  if (IDEA_TOKEN.test(raw)) return raw;
  try { const url = new URL(raw); const token = new URLSearchParams(url.hash.slice(1)).get('invite'); return token && IDEA_TOKEN.test(token) ? token : null; } catch { return null; }
}
export function initialToken(): string {
  const params = new URLSearchParams(location.hash.slice(1));
  const incoming = params.get('invite');
  if (incoming && IDEA_TOKEN.test(incoming)) {
    params.delete('invite');
    history.replaceState(null, '', location.pathname + location.search + (params.size ? `#${params}` : ''));
    try { localStorage.setItem(TOKEN_KEY,incoming); } catch { /* Keep it for this visit. */ }
    return incoming;
  }
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
export function cardFromHash(): string | null { const id = new URLSearchParams(location.hash.slice(1)).get('idea'); return id && IDEA_ID.test(id) ? id : null; }
export function ideasLink(id?: string): string { return `${LIVE_PLUNGE}/?ideas=1${id ? `#idea=${id}` : ''}`; }
export function deviceContext(): string { return `${navigator.userAgent.slice(0,300)}; ${innerWidth}×${innerHeight}; build ${BUILD_ID}`; }
export class InviteError extends Error {}
export async function ideasApi<T>(token: string, path = '', data?: unknown, method = 'PUT'): Promise<T> {
  const response = await fetch(`/api/ideas${path}`, { method: data === undefined ? 'GET' : method,
    headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : {'Content-Type':'application/json'}) },
    ...(data === undefined ? {} : {body:JSON.stringify(data)}), cache:'no-store', signal:AbortSignal.timeout(20000) });
  const result = await response.json() as T & {error?:string};
  if (response.status === 401) throw new InviteError(result.error);
  if (!response.ok) throw new Error(result.error ?? 'Could not connect. Please try again.');
  return result;
}
export interface Draft {id:string; body:string}
export function readDraft(key: string): Draft { try { const d = JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null;
  if (d && IDEA_ID.test(d.id) && typeof d.body==='string') return d; } catch { /* A new draft still works. */ }
  return {id:newId(),body:''}; }
