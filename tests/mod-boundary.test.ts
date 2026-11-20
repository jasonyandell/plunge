/** The mod boundary. Core reaches mods only through the src/mods/index.ts list, which
 * only src/kernel imports; a mod reaches core only through src/kernel/mod-api.ts. */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { MODS } from '../src/mods';

const root = resolve(__dirname, '..');
const posix = (path: string) => path.split(sep).join('/');
const sources = (dir: string): string[] => readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
  .filter(e => e.isFile() && /\.(ts|tsx|js|mjs|jsx)$/.test(e.name))
  .map(e => posix(relative(root, join(e.parentPath, e.name))));
const IMPORT = /\bimport\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]|\bexport\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
/** Each import of a file, resolved to a repo path when relative. */
function imports(file: string): string[] {
  return [...readFileSync(join(root, file), 'utf8').matchAll(IMPORT)].map(m => m[1] ?? m[2] ?? m[3]!)
    .map(spec => spec.startsWith('.') ? posix(relative(root, resolve(root, dirname(file), spec))) : spec);
}

describe('mod boundary', () => {
  it('core imports no mod folder, and only src/kernel imports the src/mods list', () => {
    const broken = [...sources('src'), ...sources('worker')].filter(f => !f.startsWith('src/mods/')).flatMap(file =>
      imports(file).filter(path => path === 'src/mods' || path.startsWith('src/mods/'))
        .filter(path => !(file.startsWith('src/kernel/') && /^src\/mods(\/index(\.ts)?)?$/.test(path)))
        .map(path => `${file} imports ${path}`));
    expect(broken, 'Core code must not reach into a mod. If two mods need this, move it into src/kernel '
      + '(and export it from src/kernel/mod-api.ts); if it is one mod\'s, keep it inside that mod\'s folder. '
      + 'Only src/kernel may import the mod list, src/mods/index.ts.').toEqual([]);
  });

  it('mods import only preact, src/engine, src/kernel/mod-api and their own folder', () => {
    const broken = sources('src/mods').filter(f => f !== 'src/mods/index.ts').flatMap(file => {
      const own = file.split('/').slice(0, 3).join('/') + '/';
      return imports(file).filter(path => !(path === 'preact' || path.startsWith('preact/')
        || path === 'src/engine' || path.startsWith('src/engine/')
        || /^src\/kernel\/mod-api(\.ts)?$/.test(path) || path.startsWith(own))).map(path => `${file} imports ${path}`);
    });
    expect(broken, 'A mod may import only preact, src/engine (read-only), src/kernel/mod-api.ts and files in its own '
      + 'folder. Copy what only this mod needs into its folder; if another mod needs it too, add it to the kernel and '
      + 'export it from src/kernel/mod-api.ts.').toEqual([]);
  });

  it('the list holds one manifest per mod folder, named for its folder', () => {
    const folders = readdirSync(join(root, 'src/mods'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
    expect(MODS.map(m => m.id).sort(), 'Each src/mods/<id>/ needs its manifest, with that id, in src/mods/index.ts.').toEqual(folders);
  });
});
