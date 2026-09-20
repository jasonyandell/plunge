import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../src/ai/phone/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
if (manifest.build?.target !== 'wasm32-unknown-unknown' || manifest.build.default_features !== false ||
    JSON.stringify(manifest.build.features) !== JSON.stringify(['cpu-speedups']))
  throw new Error('The phone requires the explicit portable cpu-speedups build.');
const bytes = readFileSync(new URL('walt-player.wasm', root));
if (createHash('sha256').update(bytes).digest('hex') !== manifest.wasm_sha256) throw new Error('Walt asset and manifest differ; import a matched build.');
const module = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`).sort();
if (JSON.stringify(imports) !== JSON.stringify(['walt_host.checkpoint','walt_host.now_us'])) throw new Error(`Unexpected host capabilities: ${imports}`);
const exports = new Map(WebAssembly.Module.exports(module).map((x) => [x.name, x.kind]));
for (const name of ['walt_in_prepare', 'walt_call', 'walt_out_ptr']) {
  if (exports.get(name) !== 'function') throw new Error(`Missing player ABI export: ${name}`);
}
if (exports.get('memory') !== 'memory') throw new Error('Missing player memory export.');
console.log(`Verified ${manifest.player} · ${bytes.length} bytes`);
