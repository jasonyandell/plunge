/** Select a release profile before provisioning. Never fall back after an API error. */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function productionProfile(config, profile) {
  if (!['core', 'companions'].includes(profile)) throw new Error('PLUNGE_DEPLOY_PROFILE must be core or companions.');
  if (profile === 'companions') return config;
  let oauth = 0;
  const result = config.replace(/^\[\[kv_namespaces\]\]\r?\n(?:(?!^\[)[\s\S])*/gm, block => {
    const binding = /^binding\s*=\s*"([^"]+)"\s*$/m.exec(block)?.[1];
    if (binding === 'OAUTH_KV') oauth++;
    return ['OAUTH_KV', 'IDEAS_CACHE'].includes(binding) ? '' : block;
  });
  if (oauth !== 1) throw new Error('Expected exactly one production OAuth binding.');
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const profile = process.env.PLUNGE_DEPLOY_PROFILE;
  writeFileSync('wrangler.toml', productionProfile(readFileSync('wrangler.toml', 'utf8'), profile));
  const version = JSON.parse(readFileSync('dist/version.json', 'utf8'));
  writeFileSync('dist/version.json', JSON.stringify({ ...version, companions: profile === 'companions' }));
  console.log(profile === 'core'
    ? 'Deploying game and idea board. Chat companion routes remain unavailable (503); no KV provisioning is requested.'
    : 'Deploying game, idea board and companions. OAuth storage provisioning must succeed.');
}
