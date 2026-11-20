import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import { MODS } from '../src/mods';
import { MOD_CATEGORIES, type ModCategory, type ModManifest } from '../src/kernel/mod-api';
import { ModsList, linkNotice, modGroups, type ModsListProps } from '../src/kernel/ModsSettings';

const mod = (id: string, category: ModCategory, more: Partial<ModManifest> = {}): ModManifest =>
  ({ id, title: id, summary: '', category, details: '', defaultOn: false, scope: 'device', slots: {}, ...more });
const ids = (groups: ReturnType<typeof modGroups>) => groups.map(g => [g.category.id, g.mods.map(m => m.id)]);

type Node = VNode<Record<string, unknown> & { children?: unknown }>;
const nodes = (n: unknown): Node[] => Array.isArray(n) ? n.flatMap(nodes)
  : n && typeof n === 'object' && 'props' in n ? [n as Node, ...nodes((n as Node).props.children)] : [];
const text = (n: unknown): string => Array.isArray(n) ? n.map(text).join('')
  : typeof n === 'string' || typeof n === 'number' ? String(n) : n && typeof n === 'object' && 'props' in n ? text((n as Node).props.children) : '';
const render = (p: Partial<ModsListProps> = {}) => ModsList({ mods: MODS, enabled: new Set(), link: {}, query: '', open: null,
  onQuery: () => {}, onOpen: () => {}, onSwitch: () => {}, onKeep: () => {}, ...p });
const shownCategories = (tree: unknown) => nodes(tree).map(n => n.props['data-category']).filter(Boolean);

describe('More → Mods', () => {
  it('gives every mod a category from the list, a summary and details', () => {
    const known = MOD_CATEGORIES.map(c => c.id) as string[];
    for (const m of MODS) {
      expect(known, m.id).toContain(m.category);
      expect(m.summary.length, m.id).toBeGreaterThan(0);
      expect(m.details.length, m.id).toBeGreaterThan(m.summary.length / 2);
    }
  });
  it('lists the categories in order, with their gists', () => {
    expect(MOD_CATEGORIES.map(c => [c.id, c.title])).toEqual([['help', 'Helpers'], ['table', 'At the table'], ['family', 'Family tables'],
      ['looks', 'Looks and fun'], ['rules', 'Rules of the game'], ['players', 'Computer players']]);
    expect(MOD_CATEGORIES.find(c => c.id === 'rules')?.gist).toBe('Variants of 42 the whole table plays by. Set by whoever opens the table.');
    expect(MOD_CATEGORIES.find(c => c.id === 'players')?.gist).toBe('How Walt and Zeb bid and play. Set per table.');
  });
  it('groups mods by category order, keeping list order inside a group', () => {
    const list = [mod('fun', 'looks'), mod('count', 'help'), mod('seat', 'table'), mod('hint', 'help')];
    expect(ids(modGroups('', list))).toEqual([['help', ['count', 'hint']], ['table', ['seat']], ['looks', ['fun']]]);
    expect(ids(modGroups(''))).toEqual([
      ['help', ['bidding-hint', 'domino-counter']],
      ['table', ['partner-badge', 'nello-sitout-view', 'drag-arrange']],
      ['family', ['flash-let-in', 'vote-notice']],
      ['looks', ['cherry-blossoms', 'winner-congrats', 'shuffle-flourish', 'birdwatcher']],
    ]);
  });
  it('searches title, summary and details in any case, and hides empty categories', () => {
    const list = [mod('a', 'help', { title: 'Domino Counter' }), mod('b', 'table', { summary: 'Drag your TILES' }),
      mod('c', 'looks', { details: 'From Rose’s idea' })];
    expect(ids(modGroups('counter', list))).toEqual([['help', ['a']]]);
    expect(ids(modGroups('  tiles ', list))).toEqual([['table', ['b']]]);
    expect(ids(modGroups('ROSE', list))).toEqual([['looks', ['c']]]);
    expect(modGroups('zzz', list)).toEqual([]);
    expect(ids(modGroups('blossoms'))).toEqual([['looks', ['cherry-blossoms']]]);
  });
  it('shows "No mods match" only when the search finds nothing', () => {
    const none = render({ query: 'no such mod' });
    expect(text(none)).toContain('No mods match.');
    expect(shownCategories(none)).toEqual([]);
    expect(text(render())).not.toContain('No mods match');
    expect(shownCategories(render({ query: 'tandem' }))).toEqual(['looks']);
  });
  it('never shows the reserved categories while they have no mods', () => {
    expect(shownCategories(render())).toEqual(['help', 'table', 'family', 'looks']);
    expect(text(render())).not.toMatch(/Rules of the game|Computer players/);
    expect(shownCategories(render({ mods: [...MODS, mod('house', 'rules')] }))).toContain('rules');
  });
  it('opens a row’s details and switches from the row’s own switch', () => {
    const onOpen = vi.fn(), onSwitch = vi.fn();
    const tree = render({ enabled: new Set(['domino-counter']), open: 'domino-counter', onOpen, onSwitch });
    const details = nodes(tree).filter(n => n.props.class === 'mod-details');
    expect(details.filter(n => !n.props.hidden).map(n => n.props.id)).toEqual(['mod-domino-counter-details']);
    expect(text(details.find(n => !n.props.hidden))).toContain('Jason’s idea');
    expect(text(details.find(n => !n.props.hidden))).toContain('Just this device');
    const switches = nodes(tree).filter(n => n.props.role === 'switch');
    expect(switches.length).toBe(MODS.length);
    (switches.find(n => n.props['aria-label'] === 'Domino counter')!.props.onClick as () => void)();
    expect(onSwitch).toHaveBeenCalledWith('domino-counter', false);
    (nodes(tree).find(n => n.props['aria-controls'] === 'mod-domino-counter-details')!.props.onClick as () => void)();
    expect(onOpen).toHaveBeenCalledWith(null);
  });
  it('says what a link turned on, in its row and once at the top, each with Keep it', () => {
    expect(linkNotice({})).toBeNull();
    expect(linkNotice({ 'partner-badge': true, 'domino-counter': true, 'bidding-hint': false }))
      .toBe('On for this visit, from your link: Domino counter, Partner badge. Off for this visit, from your link: Bidding hints.');
    const onKeep = vi.fn();
    const tree = render({ link: { 'domino-counter': true }, enabled: new Set(['domino-counter']), onKeep });
    const all = nodes(tree), top = all.find(n => n.props.class === 'mods-link')!;
    expect(all.indexOf(top)).toBeLessThan(all.findIndex(n => n.props.class === 'mods-search'));
    expect(text(top)).toBe('On for this visit, from your link: Domino counter.Keep it');
    const row = all.find(n => n.props['data-mod'] === 'domino-counter')!;
    expect(text(row)).toContain('On for this visit, from your link. Keep it');
    const keeps = all.filter(n => text(n) === 'Keep it' && n.type === 'button');
    expect(keeps.length).toBe(2);
    for (const k of keeps) (k.props.onClick as () => void)();
    expect(onKeep.mock.calls).toEqual([[null], ['domino-counter']]);
    expect(nodes(render()).some(n => n.props.class === 'mods-link')).toBe(false);
  });
});
