import type { ComponentType } from 'preact';
import { MODS } from '../mods';
import type { SlotName, SlotProps } from './mod-api';
import { useMods } from './mods';

/** Mods' pieces for one place on screen, in registry order. Nothing when no mod is on. */
export function Slot<N extends SlotName>({ name, props }: { name: N; props: SlotProps[N] }) {
  const parts = slotParts(name, useMods().enabled);
  if (!parts.length) return null;
  return <>{parts.map(({ id, Part }) => <Part key={id} {...props} />)}</>;
}

export function slotParts<N extends SlotName>(name: N, enabled: ReadonlySet<string>) {
  return MODS.flatMap(mod => {
    const Part = mod.slots[name] as ComponentType<SlotProps[N]> | undefined;
    return Part && enabled.has(mod.id) ? [{ id: mod.id, Part }] : [];
  });
}
