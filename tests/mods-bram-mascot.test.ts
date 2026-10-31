import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VNode } from 'preact';
import { newGame, TOURNAMENT_CONFIG } from '../src/engine';
import { modState, reloadMods } from '../src/kernel/mods';
import { slotParts } from '../src/kernel/Slot';
import type { TableSlotProps } from '../src/kernel/mod-api';
import { Bram } from '../src/mods/bram-mascot/Bram';

const visit = (search: string) => {
  vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods();
};
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });

describe('bram mascot', () => {
  it('adds nothing above the hand unless ?mods=bram-mascot', () => {
    visit('');
    expect(slotParts('table-above-hand', modState().enabled)).toEqual([]);
    visit('?mods=bram-mascot');
    const parts = slotParts('table-above-hand', modState().enabled);
    expect(parts.map(p => p.id)).toEqual(['bram-mascot']);
    const node = (parts[0]!.Part as (p: TableSlotProps) => VNode)({ game: newGame(TOURNAMENT_CONFIG, 'bram'), seat: 0 });
    expect(node.type).toBe(Bram);
  });
  it('is a picture only: hidden from screen readers and never in the way of a tap', () => {
    const node = Bram() as VNode<{ class: string; 'aria-hidden': string; children: VNode }>;
    expect(node.props).toMatchObject({ class: 'bram-mascot', 'aria-hidden': 'true' });
    expect(node.props.children.type).toBe('svg');
    expect(readFileSync(resolve(__dirname, '../src/mods/bram-mascot/bram.css'), 'utf8')).toMatch(/^\.bram-mascot \{[^}]*pointer-events: none;/m);
  });
  it('only bobs when motion is welcome', () => {
    const css = readFileSync(resolve(__dirname, '../src/mods/bram-mascot/bram.css'), 'utf8');
    const still = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/, '');
    expect(still).not.toBe(css);
    expect(still).not.toMatch(/animation:/);
  });
});
