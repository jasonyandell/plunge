import { useRef, useState } from 'preact/hooks';
import type { StatsStatus } from '../history/stats-sync';
import { AccountPage, type AccountBackend } from './Account';
import { DEMO_ME } from './me';

/** A browser-only walkthrough of inviting family: the real account screens against a
 * sample backend. No account service, passkey, upload or share sheet is involved.
 * State lives in this tab's session storage, so the invite link opens on "Benny's phone". */
const STORAGE = 'plunge:account-demo:v1';
type Persona = 'mom' | 'benny';
interface DemoInvite { id: string; token: string; name: string; joined: boolean }
interface Demo { persona: Persona; momIn: boolean; bennyIn: boolean; momName: string; invite: DemoInvite | null }
const fresh = (): Demo => ({ persona: 'mom', momIn: true, bennyIn: false, momName: 'Mom', invite: null });
const MOM = 'd0000000000000000000000000000001';
const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const joinToken = () => new URLSearchParams(location.hash.slice(1)).get('join');

function load(): Demo {
  let demo = fresh();
  try { const saved = JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null') as Demo | null; if (saved && (saved.persona === 'mom' || saved.persona === 'benny')) demo = saved; } catch { /* A fresh walkthrough. */ }
  // Opening the invite link is Benny tapping it on his phone.
  const token = joinToken();
  return token && demo.invite?.token === token ? { ...demo, persona: 'benny' } : demo;
}
function store(demo: Demo) { try { sessionStorage.setItem(STORAGE, JSON.stringify(demo)); } catch { /* This visit only. */ } }

/** The account service, in memory: Mom is signed in with family access; Benny has 23 hands on his phone and no account. */
function demoBackend(get: () => Demo, set: (demo: Demo) => void): AccountBackend {
  const linkFor = (token: string) => `${location.origin}${location.pathname}?account=1&demo=invite#join=${token}`;
  const invite = (name: string): DemoInvite => ({ id: hex(16), token: hex(32), name, joined: false });
  const api = async <T,>(path = '', body?: unknown): Promise<T> => {
    await pause(150);
    const demo = get(), data = (body ?? {}) as Record<string, unknown>, mom = demo.persona === 'mom';
    const me = mom ? demo.momIn ? { id: MOM, name: demo.momName, owner: 0, requested: 0, family: 1 } : null
      : demo.bennyIn && demo.invite ? { id: demo.invite.id, name: demo.invite.name, owner: 0, requested: 0, family: 1 } : null;
    const answer = (value: unknown) => value as T;
    switch (path) {
      case '': return answer({ account: me, available: true });
      case '/invites': return answer({ invites: mom && demo.invite ? [{ id: demo.invite.id, name: demo.invite.name, joined: demo.invite.joined ? 1 : 0 }] : [] });
      case '/invite': {
        if (!mom || !demo.momIn) throw new Error('Invites come from someone with family access.');
        if (typeof data.name === 'string' && demo.invite && !demo.invite.joined && demo.invite.name !== data.name)
          throw new Error('This walkthrough has one invite. Choose Start over to try another name.');
        if (demo.invite?.joined) throw new Error(`${demo.invite.name} already joined. Choose Start over to try again.`);
        const next = typeof data.name === 'string' ? invite(data.name) : { ...demo.invite!, token: hex(32) };
        set({ ...demo, invite: next });
        return answer({ id: next.id, url: linkFor(next.token) });
      }
      case '/invite/peek':
        if (!demo.invite || demo.invite.joined || data.token !== demo.invite.token) throw new Error('That link has expired or was already used. Ask whoever sent it for a new one.');
        return answer({ name: demo.invite.name, invitedBy: demo.momName, joined: false, you: false });
      case '/passkey/recover/options': case '/passkey/login/options': case '/passkey/add/options': return answer({});
      case '/passkey/recover/finish':
        if (!demo.invite || demo.invite.joined) throw new Error('That link has expired or was already used.');
        set({ ...demo, bennyIn: true, invite: { ...demo.invite, joined: true } });
        return answer({ ok: true });
      case '/passkey/login/finish':
        if (mom) { set({ ...demo, momIn: true }); return answer({ ok: true }); }
        if (demo.invite?.joined) { set({ ...demo, bennyIn: true }); return answer({ ok: true }); }
        throw new Error('There’s no Plunge passkey on this phone yet. Open Mom’s invite to save a seat.');
      case '/passkey/add/finish': return answer({ ok: true });
      case '/passkey/register/options': throw new Error('This walkthrough is about invites. Switch to Mom’s phone to send one.');
      case '/logout': set(mom ? { ...demo, momIn: false } : { ...demo, bennyIn: false }); return answer({ ok: true });
      case '/profile':
        if (mom && typeof data.name === 'string') set({ ...demo, momName: data.name });
        else if (demo.invite && typeof data.name === 'string') set({ ...demo, invite: { ...demo.invite, name: data.name } });
        return answer({ ok: true });
      default: throw new Error('That part isn’t in this walkthrough.');
    }
  };
  return {
    api,
    // The phone's face, fingerprint or passcode check, played as a short pause.
    register: () => pause(900), authenticate: () => pause(900),
    supported: true, localOnly: false,
    stats: async (account?: string): Promise<StatsStatus> => {
      const demo = get();
      if (demo.persona === 'mom') return { account: account ?? null, device: 12, connected: account ? 12 : 0, waiting: 0, rejected: 0, total: account ? 140 : null };
      return { account: account ?? null, device: 23, connected: account ? 23 : 0, waiting: 0, rejected: 0, total: account ? 23 : null };
    },
    share: async () => 'shown',
    sitDown: async () => {
      const demo = get();
      try { sessionStorage.setItem(DEMO_ME, demo.invite?.name ?? 'Benny'); } catch { /* The home screen shows Sign in instead. */ }
      location.assign('/');
    },
  };
}

export function AccountDemo() {
  const [demo, setDemo] = useState(load);
  const [screen, setScreen] = useState(0);
  // The backend reads and writes the latest state, not a render's copy.
  const current = useRef(demo);
  const set = (next: Demo) => { current.current = next; store(next); setDemo(next); };
  const [backend] = useState(() => demoBackend(() => current.current, set));
  const show = (persona: Persona, hash = '') => {
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    set({ ...current.current, persona }); setScreen(n => n + 1);
  };
  const restart = () => {
    try { sessionStorage.removeItem(DEMO_ME); } catch { /* Nothing kept. */ }
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    set(fresh()); setScreen(n => n + 1);
  };
  const invite = demo.invite, name = invite?.name ?? 'Benny';
  const hint = demo.persona === 'mom'
    ? !invite ? 'Mom wants Uncle Benny at the family table. Under Invite family, type his name and tap Send an invite.'
      : invite.joined ? `${name} joined. His invite now says Joined.`
      : `The invite is ready. On a real phone it goes out by text from the share sheet.`
    : invite?.joined ? `${name} is in, with his 23 hands from that phone.` : `This is what ${name} sees when he taps the link. Tap Save my seat; his phone checks his face or fingerprint.`;
  const bar = <div class="account-demo">
    <aside class="demo-banner"><strong>Sample walkthrough: inviting family</strong>
      <p>The real screens with sample people. Nothing is sent, saved to an account, or asked of your phone.</p>
      <p class="account-demo-hint" role="status">{hint}</p>
      <div class="account-demo-actions">
        {demo.persona === 'mom' && invite && !invite.joined && <button class="big-btn" onClick={() => show('benny', `#join=${invite.token}`)}>Open it on {name}’s phone →</button>}
        {demo.persona === 'benny' && invite?.joined && <a class="big-btn" href="/" onClick={() => { try { sessionStorage.setItem(DEMO_ME, name); } catch { /* Sign in shows instead. */ } }}>See {name}’s home screen →</a>}
        <button class="text-btn" onClick={restart}>Start over</button>
      </div>
    </aside>
    <div class="demo-people" role="group" aria-label="Whose phone">
      <button aria-pressed={demo.persona === 'mom'} onClick={() => show('mom')}>{demo.momName}’s phone</button>
      <button aria-pressed={demo.persona === 'benny'} disabled={!invite} onClick={() => show('benny', invite && !invite.joined ? `#join=${invite.token}` : '')}>{name}’s phone</button>
    </div>
  </div>;
  return <AccountPage key={`${demo.persona}:${screen}`} backend={backend} heading={bar} />;
}
