import { useEffect, useState } from 'preact/hooks';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import { rememberedMe, whoAmI, type Me } from './me';

/** Who's here: your name, or a quiet "Sign in" for anyone who wants more. Playing never
 * needs it. Previews lead to the dashboard's real sign-in handoff. */
export function IdentityChip() {
  const [me, setMe] = useState<Me | null | undefined>(() => rememberedMe() ?? undefined);
  useEffect(() => { let live = true; void whoAmI().then(value => { if (live) setMe(value); }); return () => { live = false; }; }, []);
  if (QUESTIONS_LOCAL_ONLY) return <a class="home-me" href="?ideas=1">Open family ideas</a>;
  if (me === undefined) {
    return null;
  }
  const waiting = me?.waiting ? `${me.waiting} waiting` : '';
  return <a class={me ? 'home-me signed-in' : 'home-me'} href="?account=1" aria-label={me ? `Signed in as ${me.name}. Your account${waiting ? `, ${waiting} to come in` : ''}` : 'Sign in, optional'}>
    {me ? me.name : 'Sign in'}{waiting && <span class="home-me-waiting">{waiting}</span>}
  </a>;
}
