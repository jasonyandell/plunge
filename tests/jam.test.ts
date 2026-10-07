/** Family jam client helpers and the home-screen entry point (vnode checks, no DOM). */
import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import { STATUS_LABEL, deviceNote, jamInvite, jamRequested, loadIdentity, passphraseFromHash, saveIdentity, whenLabel } from '../src/jam/client';
import { Home } from '../src/ui/Home';
import { initialApp } from '../src/ui/store';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}
const flatten = (v: unknown, out: VNode[] = []): VNode[] => {
  if (Array.isArray(v)) { v.forEach(child => flatten(child, out)); return out; }
  if (v && typeof v === 'object' && 'props' in v) { out.push(v as VNode); flatten((v as VNode).props.children, out); }
  return out;
};

describe('jam invites and identity', () => {
  it('reads the passphrase from an invite hash and writes one back', () => {
    expect(passphraseFromHash('#jam=Pie%20by%20Thanksgiving')).toBe('Pie by Thanksgiving');
    expect(passphraseFromHash('#room=abc')).toBeNull();
    expect(passphraseFromHash('#jam=')).toBeNull();
    expect(jamInvite('Pie by Thanksgiving', 'https://plunge.test', '/')).toBe('https://plunge.test/?jam=1#jam=Pie%20by%20Thanksgiving');
    expect(jamRequested('?jam=1', '')).toBe(true); expect(jamRequested('', '#jam=x')).toBe(true); expect(jamRequested('?rooms=1', '#room=x')).toBe(false);
  });
  it('remembers who is at the table on this device', () => {
    const storage = new MemoryStorage();
    expect(loadIdentity(storage)).toBeNull();
    saveIdentity({ name: 'Mom', passphrase: 'pie' }, storage);
    expect(loadIdentity(storage)).toEqual({ name: 'Mom', passphrase: 'pie' });
    storage.setItem('plunge:jam', '{"name":"x"}');
    expect(loadIdentity(storage)).toBeNull();
  });
  it('describes the device without identifying the person', () => {
    const note = deviceNote({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }, 390, 844);
    expect(note).toMatch(/^iPhone · Safari · 390×844 · build /);
  });
  it('tells time like a kitchen table', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    expect(whenLabel('2026-10-07T11:59:40Z', now)).toBe('Just now');
    expect(whenLabel('2026-10-07T11:48:00Z', now)).toBe('12 min ago');
    expect(whenLabel('2026-10-07T09:00:00Z', now)).toBe('3 hr ago');
    expect(whenLabel('2026-10-06T10:00:00Z', now)).toBe('Yesterday');
    expect(whenLabel('2026-10-01T10:00:00Z', now)).toBe('6 days ago');
    expect(Object.keys(STATUS_LABEL)).toEqual(['waiting', 'working', 'preview', 'shipped', 'closed']);
  });
});

describe('<Home>', () => {
  it('offers the family jam when the app can open it', () => {
    const nodes = flatten(Home({ app: initialApp(null), dispatch: () => {}, onJam: () => {} }));
    const button = nodes.find(n => n.type === 'button' && String(n.props.children).includes('Family jam'));
    expect(button).toBeDefined();
    expect(String((button!.props as Record<string, unknown>).class)).toContain('big-btn');
    expect(flatten(Home({ app: initialApp(null), dispatch: () => {} })).some(n => String(n.props.children).includes('Family jam'))).toBe(false);
  });
});
