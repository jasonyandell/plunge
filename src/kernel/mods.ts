/** Which mods are on: built-in defaults, then this device's choices, then the
 * visit's `?mods=a,-b` link. "Keep it" turns the link's choices into the device's. */
import { useEffect, useState } from 'preact/hooks';
import { MODS } from '../mods';
import type { ModManifest } from './mod-api';

export const MOD_CHOICES_KEY = 'plunge:mods:v1';
type Choices = Readonly<Record<string, boolean>>;

/** `?mods=a,-b`: a on, b off. Unknown ids are dropped. */
export function linkChoices(search: string, mods: readonly ModManifest[] = MODS): Choices {
  const known = new Set(mods.map(m => m.id)), out: Record<string, boolean> = {};
  for (const raw of (new URLSearchParams(search).get('mods') ?? '').split(',')) {
    const word = raw.trim(), off = word.startsWith('-'), id = off ? word.slice(1) : word;
    if (known.has(id)) out[id] = !off;
  }
  return out;
}

export function enabledMods(mods: readonly ModManifest[], device: Choices, link: Choices): ReadonlySet<string> {
  return new Set(mods.filter(m => link[m.id] ?? device[m.id] ?? m.defaultOn).map(m => m.id));
}

export function loadChoices(): Choices {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MOD_CHOICES_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, on]) => typeof on === 'boolean'));
  } catch { return {}; }
}

function saveChoices(choices: Choices): boolean {
  try { localStorage.setItem(MOD_CHOICES_KEY, JSON.stringify(choices)); return true; } catch { return false; }
}

interface ModState { device: Choices; link: Choices; enabled: ReadonlySet<string> }
let state: ModState | null = null;
const listeners = new Set<() => void>();

function current(): ModState {
  if (!state) {
    const device = loadChoices(), link = linkChoices(typeof location === 'undefined' ? '' : location.search);
    state = { device, link, enabled: enabledMods(MODS, device, link) };
  }
  return state;
}

function update(device: Choices, link: Choices): void {
  state = { device, link, enabled: enabledMods(MODS, device, link) };
  saveChoices(device);
  for (const listener of listeners) listener();
}

/** Turns a mod on or off for this device; it outranks the link from then on. */
export function setModOn(id: string, on: boolean): void {
  const { device, link } = current();
  const { [id]: _, ...rest } = link;
  update({ ...device, [id]: on }, rest);
}

/** Keep the link's choices on this device. */
export function keepLinkMods(): void {
  const { device, link } = current();
  update({ ...device, ...link }, {});
}

/** Forget this module's cached state (tests, and a storage change from elsewhere). */
export function reloadMods(): void { state = null; for (const listener of listeners) listener(); }

export function modState(): ModState { return current(); }

export function useMods(): ModState {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender(n => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return current();
}
