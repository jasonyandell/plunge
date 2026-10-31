import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VNode } from 'preact';
import { modState, reloadMods } from '../src/kernel/mods';
import { Doorbell } from '../src/room/VoteBar';
import { flashLetIn } from '../src/mods/flash-let-in';

const css = readFileSync(resolve(__dirname, '../src/mods/flash-let-in/flash-let-in.css'), 'utf8');
const visit = (search: string) => { vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods(); };
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });

type Node = VNode<{ class?: string; children?: unknown }>;
function find(node: unknown, cls: string): Node[] {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(n => find(n, cls));
  const n = node as Node, own = n.props.class?.split(' ').includes(cls) ? [n] : [];
  return [...own, ...find(n.props.children, cls)];
}

describe('flash let-in mod', () => {
  it('is off unless the link turns it on', () => {
    expect(flashLetIn.defaultOn).toBe(false);
    visit('');
    expect(modState().enabled.has('flash-let-in')).toBe(false);
    visit('?mods=flash-let-in');
    expect(modState().enabled.has('flash-let-in')).toBe(true);
  });
  it('pulses the Let them in button core draws for a knock, twice, and holds still for reduced motion', () => {
    const bar = Doorbell({ knocks: [{ visitor: 'v', name: 'Gran' } as never], answer: () => {}, disabled: false });
    const door = find(bar, 'vote-door');
    expect(door).toHaveLength(1);
    expect(find(door[0], 'vote-yes').map(b => b.props.children)).toEqual(['Let them in']);
    const motion = /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*:root\[data-mods~="flash-let-in"\] \.vote-door \.vote-yes:not\(:disabled\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(motion).toMatch(/animation:\s*flash-let-in-pulse\b.*\b2;/);
    expect(css).toMatch(/@keyframes flash-let-in-pulse\b/);
    expect(css).toMatch(/:root\[data-mods~="flash-let-in"\] \.vote-door \.vote-yes:not\(:disabled\) \{[^}]*background: var\(--butterscotch\)/);
  });
});
