import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VNode } from 'preact';
import { newGame, TOURNAMENT_CONFIG, type GameState } from '../src/engine';
import { modState, reloadMods } from '../src/kernel/mods';
import { OpponentTop } from '../src/ui/Table';
import { partnerBadge } from '../src/mods/partner-badge';

const css = readFileSync(resolve(__dirname, '../src/mods/partner-badge/partner-badge.css'), 'utf8');
const rule = (selector: string) => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
const visit = (search: string) => { vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods(); };
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });

function classes(node: unknown): string[] {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(classes);
  const { props } = node as VNode<{ class?: string; children?: unknown }>;
  return [...(props.class ? [props.class] : []), ...classes(props.children)];
}

describe('partner badge mod', () => {
  it('is off unless the link turns it on', () => {
    expect(partnerBadge.defaultOn).toBe(false);
    visit('');
    expect(modState().enabled.has('partner-badge')).toBe(false);
    visit('?mods=partner-badge');
    expect(modState().enabled.has('partner-badge')).toBe(true);
  });
  it('styles the partner tag core draws on the top seat', () => {
    const g: GameState = { ...newGame(TOURNAMENT_CONFIG, 'partner'), phase: 'playing' };
    expect(classes(OpponentTop({ g, thinking: null }))).toContain('seat-tag seat-tag-partner');
    const pill = rule(':root[data-mods~="partner-badge"] .seat-top .seat-tag-partner');
    expect(pill).toMatch(/background:\s*#286f65/);
    expect(pill).toMatch(/border-radius/);
    expect(rule(':root[data-mods~="partner-badge"] .seat-top .seat-name')).toMatch(/font-weight:\s*700/);
  });
});
