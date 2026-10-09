import { useEffect, useState } from 'preact/hooks';
import { rememberedMe, whoAmI, type Me } from './me';

/** Who's here: your name, or a quiet "Sign in" for anyone who wants more. Playing never
 * needs it. Nothing shows where accounts don't exist (previews, local-only builds). */
export function IdentityChip() {
  const [me, setMe] = useState<Me | null | undefined>(() => rememberedMe() ?? undefined);
  useEffect(() => { let live = true; void whoAmI().then(value => { if (live) setMe(value); }); return () => { live = false; }; }, []);
  if (me === undefined) return null;
  return <a class={me ? 'home-me signed-in' : 'home-me'} href="?account=1" aria-label={me ? `Signed in as ${me.name}. Your account` : 'Sign in, optional'}>
    {me ? me.name : 'Sign in'}
  </a>;
}
