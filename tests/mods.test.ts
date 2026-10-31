import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newGame, TOURNAMENT_CONFIG, type GameState } from '../src/engine';
import { store } from '../src/kernel/store';
import {
  MOD_CHOICES_KEY, enabledMods, keepLinkMods, linkChoices, loadChoices, modState, reloadMods, setModOn,
} from '../src/kernel/mods';
import { slotParts } from '../src/kernel/Slot';
import type { ModManifest } from '../src/kernel/mod-api';
import { DominoCounter } from '../src/mods/domino-counter/DominoCounter';

function memory(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get length() { return map.size; }, clear: () => map.clear(), key: i => [...map.keys()][i] ?? null,
    getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); } };
}
const broken = (): Storage => ({ length: 0, clear() { throw new Error('denied'); }, key: () => null,
  getItem() { throw new Error('denied'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('denied'); } });
const visit = (search: string, storage: Storage = memory()) => {
  vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', storage); reloadMods(); return storage;
};
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });

const mod = (id: string, defaultOn: boolean): ModManifest => ({ id, title: id, summary: '', defaultOn, scope: 'device', slots: {} });
const mods = [mod('on-by-default', true), mod('off-by-default', false)];

describe('which mods are on', () => {
  it('starts from each manifest default', () => {
    expect([...enabledMods(mods, {}, {})]).toEqual(['on-by-default']);
  });
  it('lets a device choice override the default, and a link override both for the visit', () => {
    expect([...enabledMods(mods, { 'on-by-default': false, 'off-by-default': true }, {})]).toEqual(['off-by-default']);
    const link = linkChoices('?mods=-off-by-default,on-by-default', mods);
    expect(link).toEqual({ 'off-by-default': false, 'on-by-default': true });
    expect([...enabledMods(mods, { 'on-by-default': false, 'off-by-default': true }, link)]).toEqual(['on-by-default']);
  });
  it('ignores unknown and empty ids in a link', () => {
    expect(linkChoices('?mods=nope,-gone,,%20off-by-default%20', mods)).toEqual({ 'off-by-default': true });
    expect(linkChoices('?other=1', mods)).toEqual({});
  });
  it('is off with no link, on for a visit with ?mods=domino-counter, and forgets the visit without Keep it', () => {
    visit('');
    expect(modState().enabled.has('domino-counter')).toBe(false);
    const storage = visit('?mods=domino-counter');
    expect(modState().enabled.has('domino-counter')).toBe(true);
    expect(storage.getItem(MOD_CHOICES_KEY)).toBeNull();
    visit('', storage);
    expect(modState().enabled.has('domino-counter')).toBe(false);
  });
  it('Keep it saves the link’s choice on this device', () => {
    const storage = visit('?mods=domino-counter');
    keepLinkMods();
    expect(modState().link).toEqual({});
    visit('', storage);
    expect(modState().enabled.has('domino-counter')).toBe(true);
    visit('?mods=-domino-counter', storage);
    expect(modState().enabled.has('domino-counter')).toBe(false);
  });
  it('a switch in settings persists and outranks the link for the rest of the visit', () => {
    const storage = visit('?mods=domino-counter');
    setModOn('domino-counter', false);
    expect(modState().enabled.has('domino-counter')).toBe(false);
    expect(JSON.parse(storage.getItem(MOD_CHOICES_KEY)!)).toEqual({ 'domino-counter': false });
  });
  it('survives storage that throws: defaults and links still work, switches last the visit', () => {
    visit('?mods=domino-counter', broken());
    expect(modState().enabled.has('domino-counter')).toBe(true);
    expect(() => keepLinkMods()).not.toThrow();
    expect(() => setModOn('domino-counter', false)).not.toThrow();
    expect(modState().enabled.has('domino-counter')).toBe(false);
    expect(loadChoices()).toEqual({});
  });
  it('drops saved choices that are not booleans', () => {
    const storage = memory();
    storage.setItem(MOD_CHOICES_KEY, JSON.stringify({ 'domino-counter': 'yes', other: true }));
    visit('', storage);
    expect(loadChoices()).toEqual({ other: true });
    storage.setItem(MOD_CHOICES_KEY, '[true]');
    expect(loadChoices()).toEqual({});
  });
});

describe('store(modId)', () => {
  beforeEach(() => { visit(''); });
  it('keeps each mod’s keys apart and round-trips JSON', () => {
    const a = store('a'), b = store('b');
    expect(a.set('k', { n: 1 })).toBe(true);
    b.set('k', [2]);
    expect(a.get('k')).toEqual({ n: 1 });
    expect(b.get('k')).toEqual([2]);
    expect(localStorage.getItem('plunge:mod:a:k')).toBe('{"n":1}');
    a.remove('k');
    expect(a.get('k')).toBeNull();
    expect(b.get('k')).toEqual([2]);
  });
  it('reads garbage and throwing storage as empty, and never throws', () => {
    localStorage.setItem('plunge:mod:a:k', '{not json');
    expect(store('a').get('k')).toBeNull();
    vi.stubGlobal('localStorage', broken());
    expect(store('a').get('k')).toBeNull();
    expect(store('a').set('k', 1)).toBe(false);
    expect(() => store('a').remove('k')).not.toThrow();
  });
});

describe('table slot', () => {
  const g: GameState = { ...newGame(TOURNAMENT_CONFIG, 'slot'), phase: 'playing' };
  it('adds nothing to the table without a mods link, so the table renders as before', () => {
    visit('');
    expect(slotParts('table-above-hand', modState().enabled)).toEqual([]);
  });
  it('renders the domino counter with ?mods=domino-counter', () => {
    visit('?mods=domino-counter');
    const parts = slotParts('table-above-hand', modState().enabled);
    expect(parts.map(p => p.id)).toEqual(['domino-counter']);
    const node = (parts[0]!.Part as (p: { game: GameState; seat: 0 }) => { type: unknown; props: { g: GameState } })({ game: g, seat: 0 });
    expect(node.type).toBe(DominoCounter);
    expect(node.props.g).toBe(g);
  });
});
