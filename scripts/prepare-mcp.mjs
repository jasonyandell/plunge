/** OAuth storage belongs only to production. PR previews never load this config. */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cloudflare } from './preview.mjs';

const title = 'plunge-oauth';
export async function prepareMcp(api, config) {
  const pattern = /(\[\[kv_namespaces\]\]\s*binding = "OAUTH_KV"\s*id = ")([a-f0-9]{32})(")/;
  const configured = pattern.exec(config)?.[2];
  if (!configured) throw new Error('The production OAUTH_KV binding is missing.');
  let namespace;
  for (let page = 1; page <= 100; page++) {
    const items = await api(`/storage/kv/namespaces?per_page=100&page=${page}`);
    namespace = items.find(item => item.title === title);
    if (namespace || items.length < 100) break;
    if (page === 100) throw new Error('OAuth namespace listing exceeded the pagination limit.');
  }
  if (!namespace) {
    // A configured namespace must never be silently replaced: that would disconnect everyone.
    if (configured !== '0'.repeat(32)) throw new Error('Configured OAuth storage was not found.');
    namespace = await api('/storage/kv/namespaces', 'POST', { title });
  }
  if (namespace.title !== title || !/^[a-f0-9]{32}$/.test(namespace.id)) throw new Error('Unexpected OAuth namespace identity.');
  if (configured !== namespace.id && configured !== '0'.repeat(32)) throw new Error('OAuth storage belongs to a different configuration.');
  return config.replace(pattern, (_match, before, _id, after) => `${before}${namespace.id}${after}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = await prepareMcp(cloudflare(), readFileSync('wrangler.toml', 'utf8'));
  writeFileSync('wrangler.toml', config);
  console.log('Production OAuth storage is ready.');
}
