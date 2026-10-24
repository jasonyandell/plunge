/** Idea demos. Each lives in its own file named by its idea card id
 * (`src/ui/demos/<card id>.tsx`, default-exporting a component), so demos from
 * different ideas never collide when merged. The Try button opens `?demo=<card id>`. */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

type DemoModule = { default: ComponentType };
const DEMOS = import.meta.glob<DemoModule>('./*.tsx');
const DEMO_ID = /^[a-f0-9]{32}$/;

export function hasDemoFor(id: string | null): id is string {
  return id !== null && DEMO_ID.test(id) && `./${id}.tsx` in DEMOS;
}

/** Loads the idea's demo; an idea without one gets the normal game. */
export function IdeaDemo({ id, fallback }: { id: string; fallback: preact.ComponentChildren }) {
  const [Demo, setDemo] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const load = DEMOS[`./${id}.tsx`];
    if (!load) { setFailed(true); return; }
    load().then(module => setDemo(() => module.default), () => setFailed(true));
  }, [id]);
  if (failed) return <>{fallback}</>;
  return Demo ? <Demo /> : null;
}
