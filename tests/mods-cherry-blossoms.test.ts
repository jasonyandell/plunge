import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { modState, reloadMods } from '../src/kernel/mods';

const dir = resolve(__dirname, '../src/mods/cherry-blossoms');
const visit = (search: string) => {
  vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods();
};
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });

describe('cherry blossoms', () => {
  it('is off by default and on with ?mods=cherry-blossoms', () => {
    visit('');
    expect(modState().enabled.has('cherry-blossoms')).toBe(false);
    visit('?mods=cherry-blossoms');
    expect(modState().enabled.has('cherry-blossoms')).toBe(true);
  });
  it('sets the felt background only while on, from the blossom picture in its own folder', () => {
    const css = readFileSync(resolve(dir, 'blossoms.css'), 'utf8');
    const rule = /:root\[data-mods~="cherry-blossoms"\]\s*\{\s*--felt-background:([^;]+);/.exec(css);
    expect(rule, 'the felt background must be set under :root[data-mods~="cherry-blossoms"]').not.toBeNull();
    const urls = [...rule![1]!.matchAll(/url\('\.\/([^']+)'\)/g)].map(m => m[1]!);
    expect(urls.length).toBe(2);
    for (const file of urls) expect(existsSync(resolve(dir, file))).toBe(true);
    expect(readFileSync(resolve(dir, urls[0]!), 'utf8')).toContain('id="blossom"');
  });
  it('steps aside for forced colors', () => {
    expect(readFileSync(resolve(dir, 'blossoms.css'), 'utf8'))
      .toMatch(/@media \(forced-colors: active\)\s*\{\s*:root\[data-mods~="cherry-blossoms"\]\s*\{\s*--felt-background: none;/);
  });
});
