/** Production KV bindings. PR previews never load this config or its credentials. */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cloudflare } from './preview.mjs';

export const namespaces = { OAUTH_KV: 'plunge-oauth', IDEAS_CACHE: 'plunge-ideas-cache' };
export async function prepareKv(api, config) {
  // Validate every binding before making any request or creating anything.
  const bindings = Object.entries(namespaces).map(([binding, title]) => {
    const pattern = new RegExp(`(\\[\\[kv_namespaces\\]\\]\\s*binding = "${binding}"\\s*id = ")([a-f0-9]{32})(")`, 'g');
    const matches = [...config.matchAll(pattern)];
    if (matches.length !== 1) throw new Error(`Exactly one production ${binding} binding is required.`);
    return { title, pattern, configured: matches[0][2] };
  });
  const found = [];
  for (let page = 1; page <= 100; page++) {
    const items = await api(`/storage/kv/namespaces?per_page=100&page=${page}`);
    found.push(...items.filter(item => Object.values(namespaces).includes(item.title)));
    if (items.length < 100) break;
    if (page === 100) throw new Error('KV namespace listing exceeded the pagination limit.');
  }
  // Check all existing identities before creating a missing namespace.
  for (const { title, configured } of bindings) {
    const matching = found.filter(item => item.title === title);
    if (matching.length > 1) throw new Error(`Ambiguous KV namespace: ${title}.`);
    const namespace = matching[0];
    if (namespace && !/^[a-f0-9]{32}$/.test(namespace.id)) throw new Error('Unexpected KV namespace identity.');
    if (configured !== '0'.repeat(32) && configured !== namespace?.id)
      throw new Error(`Configured ${title} storage was not found or belongs to a different configuration.`);
  }
  const ids = new Set();
  for (const { title, pattern } of bindings) {
    const namespace = found.find(item => item.title === title)
      ?? await api('/storage/kv/namespaces', 'POST', { title });
    if (namespace.title !== title || !/^[a-f0-9]{32}$/.test(namespace.id) || ids.has(namespace.id))
      throw new Error('Unexpected or shared KV namespace identity.');
    ids.add(namespace.id);
    config = config.replace(pattern, (_match, before, _id, after) => `${before}${namespace.id}${after}`);
  }
  return config;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = await prepareKv(cloudflare(), readFileSync('wrangler.toml', 'utf8'));
  writeFileSync('wrangler.toml', config);
  console.log('Production OAuth storage and ideas cache are ready.');
}
