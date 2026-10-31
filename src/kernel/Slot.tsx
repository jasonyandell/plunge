import type { ComponentChildren, ComponentType } from 'preact';
import { MODS } from '../mods';
import { REPLACING_SLOTS, type FnSlotName, type ModManifest, type SeatSlotProps, type SlotFns, type SlotName, type SlotProps } from './mod-api';
import { modState } from './mods';

// No hooks: App re-renders on a mods change (useMods), and tests call core's sheets as plain functions.

/** Mods' pieces for one place on screen, in registry order. Nothing when no mod is on. */
export function Slot<N extends SlotName>({ name, props }: { name: N; props: SlotProps[N] }) {
  const parts = slotParts(name, modState().enabled);
  if (!parts.length) return null;
  return <>{parts.map(({ id, Part }) => <Part key={id} {...props} />)}</>;
}

/** The one enabled mod's replacement for `name`, else core's own `children`. */
export function Replaceable<N extends (typeof REPLACING_SLOTS)[number]>({ name, props, children }: { name: N; props: SlotProps[N]; children: ComponentChildren }) {
  const owner = slotParts(name, modState().enabled)[0];
  return owner ? <owner.Part {...props} /> : <>{children}</>;
}

export function slotParts<N extends SlotName>(name: N, enabled: ReadonlySet<string>, mods: readonly ModManifest[] = MODS) {
  const parts = mods.flatMap(mod => {
    const Part = mod.slots[name] as ComponentType<SlotProps[N]> | undefined;
    return Part && enabled.has(mod.id) ? [{ id: mod.id, Part }] : [];
  });
  return (REPLACING_SLOTS as readonly SlotName[]).includes(name) ? parts.slice(0, 1) : parts;
}

function slotFns<N extends FnSlotName>(name: N, enabled: ReadonlySet<string>, mods: readonly ModManifest[]): SlotFns[N][] {
  return mods.flatMap(mod => { const fn = mod.slots[name]; return fn && enabled.has(mod.id) ? [fn as SlotFns[N]] : []; });
}

/** Enabled mods that fill a replacing slot another enabled mod already owns, with that owner. */
export function slotConflicts(enabled: ReadonlySet<string>, mods: readonly ModManifest[] = MODS) {
  return REPLACING_SLOTS.flatMap(name => {
    const [owner, ...rest] = mods.filter(m => m.slots[name] && enabled.has(m.id));
    return owner ? rest.map(mod => ({ slot: name, mod: mod.id, owner: owner.id })) : [];
  });
}

/** Whether `p.seat`'s hand shows face up. Never at a shared table, whose other hands are not
 * the viewer's to see, and never the viewer's own seat, which core already shows. */
export function seatRevealed(p: SeatSlotProps, shared: boolean, enabled = modState().enabled, mods: readonly ModManifest[] = MODS): boolean {
  if (shared || p.seat === p.viewer || !p.game.hands[p.seat]?.length) return false;
  return slotFns('seat-reveal', enabled, mods).some(fn => fn(p));
}

/** A mod's words under a sitting-out hand, else core's `fallback`. */
export function seatNote(p: SeatSlotProps, fallback: string, enabled = modState().enabled, mods: readonly ModManifest[] = MODS): string {
  for (const fn of slotFns('seat-note', enabled, mods)) { const note = fn(p); if (note !== null) return note; }
  return fallback;
}
