import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { newGame, TOURNAMENT_CONFIG, type GameState, type Seat } from '../src/engine';
import { store } from '../src/kernel/store';
import {
  MOD_CHOICES_KEY, enabledMods, keepLinkMods, linkChoices, loadChoices, modState, reloadMods, setModOn,
} from '../src/kernel/mods';
import { seatNote, seatRevealed, slotConflicts, slotParts } from '../src/kernel/Slot';
import type { AuctionSlotProps, ModManifest, ModSlots, SeatSlotProps } from '../src/kernel/mod-api';
import { DominoCounter } from '../src/mods/domino-counter/DominoCounter';
import { BiddingHint } from '../src/mods/bidding-hint/BiddingHint';

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

const mod = (id: string, defaultOn: boolean, slots: ModSlots = {}): ModManifest => ({ id, title: id, summary: '', category: 'looks', details: '', defaultOn, scope: 'device', slots });
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

describe('built-in bidding hint', () => {
  const g: GameState = newGame(TOURNAMENT_CONFIG, 'hint');
  const props = (showHints: boolean): AuctionSlotProps => ({ game: g, seat: 0, player: 'walt', bookSeat: 0, showHints, sessionId: 's', questionGameId: 's', onQuestion: () => {} });
  type Node = { type: unknown; props: { g: GameState; bookSeat: Seat } } | null;
  it('is on by default and fills both auction sheets, following Show hints', () => {
    visit('');
    for (const name of ['bid-sheet', 'declare-sheet'] as const) {
      const parts = slotParts(name, modState().enabled);
      expect(parts.map(p => p.id)).toEqual(['bidding-hint']);
      const Part = parts[0]!.Part as (p: AuctionSlotProps) => Node;
      expect(Part(props(false))).toBeNull();
      expect(Part(props(true))?.type).toBe(BiddingHint);
      expect(Part(props(true))?.props.g).toBe(g);
    }
  });
  it('turns off like any mod', () => {
    visit('?mods=-bidding-hint');
    expect(slotParts('bid-sheet', modState().enabled)).toEqual([]);
  });
  it('marks <html data-mods> with the enabled mods for their stylesheets', () => {
    const setAttribute = vi.fn();
    vi.stubGlobal('document', { documentElement: { setAttribute } });
    visit('?mods=domino-counter');
    modState();
    expect(setAttribute).toHaveBeenLastCalledWith('data-mods', 'bidding-hint domino-counter');
    setModOn('bidding-hint', false);
    expect(setAttribute).toHaveBeenLastCalledWith('data-mods', 'domino-counter');
  });
});

describe('slot precedence', () => {
  const A = () => null, B = () => null;
  const list = [mod('first', true, { hand: A, 'table-decor': A }), mod('second', true, { hand: B, 'table-decor': B }), mod('off', false, { hand: B })];
  const on = enabledMods(list, {}, {});
  it('gives a replacing slot to the first enabled mod in the list, and shows the clash', () => {
    expect(slotParts('hand', on, list).map(p => p.id)).toEqual(['first']);
    expect(slotConflicts(on, list)).toEqual([{ slot: 'hand', mod: 'second', owner: 'first' }]);
    const without = enabledMods(list, { first: false }, {});
    expect(slotParts('hand', without, list).map(p => p.id)).toEqual(['second']);
    expect(slotConflicts(without, list)).toEqual([]);
  });
  it('renders every enabled mod in an adding slot, in list order', () => {
    expect(slotParts('table-decor', on, list).map(p => p.id)).toEqual(['first', 'second']);
  });
});

describe('seat reveal and notes', () => {
  const g: GameState = { ...newGame(TOURNAMENT_CONFIG, 'reveal'), phase: 'playing' };
  const at = (seat: Seat): SeatSlotProps => ({ game: g, viewer: 0, seat, name: 'Gran', relation: 'partner' });
  const peek = mod('peek', true, { 'seat-reveal': () => true, 'seat-note': ({ seat }) => seat === 2 ? 'peeking' : null });
  const shy = mod('shy', true, { 'seat-reveal': () => false, 'seat-note': () => 'shy' });
  it('shows another seat face up when a mod asks, off a shared table', () => {
    const list = [shy, peek], on = enabledMods(list, {}, {});
    expect(g.hands[2]!.length).toBe(7);
    expect(seatRevealed(at(2), false, on, list)).toBe(true);
    expect(seatRevealed(at(2), false, enabledMods(list, { peek: false }, {}), list)).toBe(false);
  });
  it('never reveals at a shared table, the viewer\'s own seat, or a seat with no tiles held', () => {
    const list = [peek], on = enabledMods(list, {}, {});
    expect(seatRevealed(at(2), true, on, list)).toBe(false);
    expect(seatRevealed(at(0), false, on, list)).toBe(false);
    expect(seatRevealed({ ...at(2), game: { ...g, hands: [g.hands[0]!, [], [], []] } }, false, on, list)).toBe(false);
  });
  it('takes the first mod\'s note, else core\'s words', () => {
    expect(seatNote(at(2), 'sitting out', enabledMods([peek, shy], {}, {}), [peek, shy])).toBe('peeking');
    expect(seatNote(at(1), 'sitting out', enabledMods([peek], {}, {}), [peek])).toBe('sitting out');
    expect(seatNote(at(1), 'sitting out', new Set(), [peek, shy])).toBe('sitting out');
  });
});

/** Selectors in a mod's CSS that could style core while the mod is off: each must start with
 * the mod's own class (`.<id>…`) or `:root[data-mods~="<id>"]`. Keyframe steps are skipped. */
function unscoped(css: string, id: string): string[] {
  const own = new RegExp(`^(\\.${id}(?=$|[-_\\s.:#\\[>+~])|:root\\[data-mods~="${id}"\\])`);
  const out: string[] = [], stack: string[] = [];
  let buf = '';
  for (const c of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (c === '{') {
      const sel = buf.trim(), parent = stack.at(-1);
      if (!sel.startsWith('@') && (parent === undefined || /^@(media|supports|container|layer)\b/.test(parent)))
        out.push(...sel.split(',').map(part => part.trim()).filter(part => !own.test(part)));
      stack.push(sel); buf = '';
    } else if (c === '}') { stack.pop(); buf = ''; } else if (c === ';') buf = ''; else buf += c;
  }
  return out;
}

describe('mod stylesheets', () => {
  it('tell scoped rules from ones that would leak', () => {
    expect(unscoped('.vote-door .vote-yes { color: red }', 'flash')).toEqual(['.vote-door .vote-yes']);
    expect(unscoped(':root { --page-background-color: red }', 'red')).toEqual([':root']);
    expect(unscoped('.redder { color: red }', 'red')).toEqual(['.redder']);
    expect(unscoped(`/* a } */ :root[data-mods~="flash"] .vote-door .vote-yes, .flash-ring:hover { color: red }
      @media (prefers-reduced-motion: reduce) { .flash { animation: none } }
      @keyframes flash-pulse { from { opacity: 1 } 50% { opacity: .5 } }`, 'flash')).toEqual([]);
  });
  it('in src/mods apply only while their mod is on', () => {
    const root = resolve(__dirname, '../src/mods');
    const leaks = readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.css'))
      .flatMap(e => { const file = join(e.parentPath, e.name), id = file.slice(root.length + 1).split(/[\\/]/)[0]!;
        return unscoped(readFileSync(file, 'utf8'), id).map(sel => `${file.slice(root.length + 1)}: ${sel}`); });
    expect(leaks, 'A mod\'s CSS is bundled whether or not it is on. Start each selector with the mod\'s own class '
      + '(.<id>…) or scope it under :root[data-mods~="<id>"] (docs-mods.md).').toEqual([]);
  });
});
