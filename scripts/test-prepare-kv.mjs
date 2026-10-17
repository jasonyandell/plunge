import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareKv } from './prepare-kv.mjs';
const oauth = { title: 'plunge-oauth', id: 'a'.repeat(32) };
const cache = { title: 'plunge-ideas-cache', id: 'b'.repeat(32) };
const config = (oauthId = '0'.repeat(32), cacheId = '0'.repeat(32)) =>
  `[[kv_namespaces]]\nbinding = "OAUTH_KV"\nid = "${oauthId}"\n\n[[kv_namespaces]]\nbinding = "IDEAS_CACHE"\nid = "${cacheId}"\n`;
test('reuses separate production namespaces across listing pages', async () => {
  const calls = [];
  const result = await prepareKv(async path => {
    calls.push(path);
    return path.endsWith('page=1') ? [oauth, ...Array.from({ length: 99 }, (_, i) => ({ title: `unrelated-${i}` }))] : [cache];
  }, config());
  assert.equal(result, config(oauth.id, cache.id)); assert.equal(calls.length, 2);
});
test('creates only missing namespaces and repeat deployments retain their identities', async () => {
  const stored = [oauth], writes = [];
  const api = async (path, method = 'GET', body) => {
    if (method === 'GET') return stored;
    writes.push({ path, method, body }); stored.push(cache); return cache;
  };
  const result = await prepareKv(api, config(oauth.id));
  assert.equal(result, config(oauth.id, cache.id));
  assert.equal(await prepareKv(api, result), result);
  assert.deepEqual(writes, [{ path: '/storage/kv/namespaces', method: 'POST', body: { title: 'plunge-ideas-cache' } }]);
});
test('validates all configured identities before creating anything', async () => {
  const methods = [];
  const api = async (_path, method = 'GET') => { methods.push(method); return []; };
  await assert.rejects(prepareKv(api, config('0'.repeat(32), cache.id)), /not found/);
  assert.deepEqual(methods, ['GET']);
  await assert.rejects(prepareKv(async () => [oauth, cache], config('c'.repeat(32))), /different configuration/);
  await assert.rejects(prepareKv(async () => { throw new Error('403'); }, config()), /403/);
});
test('rejects absent or duplicate bindings before API access', async () => {
  const api = async () => { throw new Error('must not call API'); };
  await assert.rejects(prepareKv(api, ''), /OAUTH_KV/);
  await assert.rejects(prepareKv(api, config() + config()), /OAUTH_KV/);
  await assert.rejects(prepareKv(api, config().split('\n\n')[0]), /IDEAS_CACHE/);
});
test('refuses unexpected, duplicate, or shared namespace identities', async () => {
  await assert.rejects(prepareKv(async () => [oauth, oauth, cache], config()), /Ambiguous/);
  await assert.rejects(prepareKv(async () => [oauth, {...cache, id: oauth.id}], config()), /shared/);
  await assert.rejects(prepareKv(async (_p, method = 'GET') => method === 'GET' ? [] : cache, config()), /Unexpected/);
});
test('dedicated KV secret is used only by the production setup step', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets.CLOUDFLARE_KV_API_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_KV_API_TOKEN \|\|/);
  const deploy = workflow.slice(workflow.indexOf('      - name: Prepare question database and deploy'));
  assert.doesNotMatch(deploy, /CLOUDFLARE_KV_API_TOKEN/);
  assert.doesNotMatch(readFileSync(new URL('../.github/workflows/preview.yml', import.meta.url), 'utf8'), /CLOUDFLARE_KV_API_TOKEN|prepare-kv/);
});
