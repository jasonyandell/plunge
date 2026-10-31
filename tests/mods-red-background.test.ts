import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { modState, reloadMods } from '../src/kernel/mods';
import { redBackground } from '../src/mods/red-background';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
const css = read('src/mods/red-background/red-background.css');
const visit = (search: string) => { vi.stubGlobal('location', { search }); vi.stubGlobal('localStorage', undefined); reloadMods(); };
afterEach(() => { vi.unstubAllGlobals(); reloadMods(); });

describe('red background mod', () => {
  it('is off unless the link turns it on', () => {
    expect(redBackground.defaultOn).toBe(false);
    visit('');
    expect(modState().enabled.has('red-background')).toBe(false);
    visit('?mods=red-background');
    expect(modState().enabled.has('red-background')).toBe(true);
  });
  it('sets both page background variables red while on, which the body draws', () => {
    const vars = /^:root\[data-mods~="red-background"\] \{([^}]*)\}/m.exec(css)?.[1] ?? '';
    expect(vars).toMatch(/--page-background-color:\s*#70181e;/);
    expect(vars).toMatch(/--page-background-image:[^;]*linear-gradient\(145deg, #8b2026, #70181e 65%, #541116\);/);
    const body = /\nbody \{([^}]*)\}/.exec(read('src/ui/app.css'))?.[1] ?? '';
    expect(body).toMatch(/background-color: var\(--page-background-color\)/);
    expect(body).toMatch(/background-image: var\(--page-background-image\)/);
  });
});
