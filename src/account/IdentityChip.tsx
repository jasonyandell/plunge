import { useEffect, useState } from 'preact/hooks';
import { QUESTIONS_LOCAL_ONLY } from '../questions/mode';
import { demoMe, rememberedMe, whoAmI, type Me } from './me';

/** Who's here: your name, or a quiet "Sign in" for anyone who wants more. Playing never
 * needs it. Where accounts don't exist it shows nothing, except on previews, where it
 * offers the sample walkthrough (and its sample name, once someone has tried it). */
export function IdentityChip() {
  const [me, setMe] = useState<Me | null | undefined>(() => rememberedMe() ?? undefined);
  useEffect(() => { let live = true; void whoAmI().then(value => { if (live) setMe(value); }); return () => { live = false; }; }, []);
  if (me === undefined) {
    if (!QUESTIONS_LOCAL_ONLY) return null;
    const sample = demoMe();
    return <a class={sample ? 'home-me signed-in' : 'home-me'} href="?account=1&demo=invite" aria-label={sample ? `Signed in as ${sample} in the sample walkthrough` : 'Try signing in: sample walkthrough'}>
      {sample ?? 'Sign in · sample'}
    </a>;
  }
  return <a class={me ? 'home-me signed-in' : 'home-me'} href="?account=1" aria-label={me ? `Signed in as ${me.name}. Your account` : 'Sign in, optional'}>
    {me ? me.name : 'Sign in'}
  </a>;
}
