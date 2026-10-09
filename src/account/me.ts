import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';

/** Who is signed in on this device, remembered so the home screen can say it before
 * (or without) the network. Signed out is the ordinary case: nothing is stored. */
export interface Me { name: string }
const ME = 'plunge:me';
/** The sample walkthrough's signed-in name, for this tab only. Shown only where accounts don't exist. */
export const DEMO_ME = 'plunge:account-demo:me';
export function demoMe(): string | null { try { return sessionStorage.getItem(DEMO_ME); } catch { return null; } }
/** The name someone last typed at a table, offered again when they make an account. */
const NAME = 'plunge:name';

export function rememberedMe(): Me | null {
  try { const value = JSON.parse(localStorage.getItem(ME) ?? 'null') as Me | null; return value && typeof value.name === 'string' ? value : null; } catch { return null; }
}
export function rememberMe(me: Me | null): void {
  try { if (me) localStorage.setItem(ME, JSON.stringify({ name: me.name })); else localStorage.removeItem(ME); } catch { /* The chip asks again next visit. */ }
}
export function tableName(): string {
  try { return localStorage.getItem(NAME) ?? ''; } catch { return ''; }
}
export function rememberTableName(name: string): void {
  try { if (name.trim()) localStorage.setItem(NAME, name.trim()); } catch { /* Typed again next time. */ }
}

/** Accounts live only on the main install; previews and local-only builds never offer sign-in.
 * `undefined`: accounts are unavailable here, so the home screen shows nothing. */
let asked: Promise<Me | null | undefined> | undefined;
export const whoAmI = (): Promise<Me | null | undefined> => asked ??= QUESTIONS_LOCAL_ONLY || typeof fetch !== 'function'
  ? Promise.resolve(undefined)
  : fetch('/api/account', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json())
    .then((data: { account?: { name?: unknown } | null; available?: unknown }) => {
      if (data.available !== true) return undefined;
      const me = data.account && typeof data.account.name === 'string' ? { name: data.account.name } : null;
      rememberMe(me);
      return me;
    })
    // Offline: trust what this device last knew.
    .catch(() => rememberedMe() ?? undefined);
