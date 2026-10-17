import { LIVE_PLUNGE } from './model';

const SESSION_KEY = 'plunge:ideas-preview-session';
const STATE_KEY = 'plunge:ideas-preview-signin:';
export function currentPreview() {
  return /^https:\/\/plunge-pr-([1-9][0-9]{0,8})\.texas42\.workers\.dev$/.exec(location.origin)?.[1] ?? null;
}
/** Start in the preview, finish with a real passkey on the stable site, then return.
 * The nonce is shared across tabs so a preview inside the game can open sign-in separately. */
export function previewSignInLink() {
  const pr = currentPreview();
  if (!pr) return `${LIVE_PLUNGE}/?account=1`;
  const state = crypto.randomUUID().replaceAll('-','');
  localStorage.setItem(`${STATE_KEY}${state}`,String(Date.now()+15*60*1000));
  return `${LIVE_PLUNGE}/?account=1&ideas-preview=${pr}&preview-state=${state}`;
}
export function previewSession(): string {
  const hash = new URLSearchParams(location.hash.slice(1));
  const incoming = hash.get('preview-session'), state = hash.get('preview-state');
  if (incoming !== null) {
    hash.delete('preview-session');hash.delete('preview-state');
    history.replaceState(null,'',location.pathname+location.search+(hash.size?`#${hash}`:''));
    try {
      sessionStorage.removeItem(SESSION_KEY);
      const expires = state && /^[a-f0-9]{32}$/.test(state) ? Number(localStorage.getItem(`${STATE_KEY}${state}`)) : 0;
      if (state) localStorage.removeItem(`${STATE_KEY}${state}`);
      if (currentPreview() && expires > Date.now() && incoming.length <= 2048 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(incoming)) {
        const payload = JSON.parse(atob(incoming.split('.')[0]!.replaceAll('-','+').replaceAll('_','/'))) as {state?:unknown;origin?:unknown};
        if (payload.state !== state || payload.origin !== location.origin) return '';
        sessionStorage.setItem(SESSION_KEY,incoming);return incoming;
      }
    } catch {return '';}
    return '';
  }
  try {return currentPreview() ? sessionStorage.getItem(SESSION_KEY) ?? '' : '';} catch {return '';}
}
export function clearPreviewSession() {
  try {sessionStorage.removeItem(SESSION_KEY);} catch { /* Visit-only storage. */ }
}
