import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareMcp } from './prepare-mcp.mjs';
const namespace = { title: 'plunge-oauth', id: 'a'.repeat(32) };
const config = (id = '0'.repeat(32)) => `[[kv_namespaces]]\nbinding = "OAUTH_KV"\nid = "${id}"\n`;
test('reuses production OAuth storage, including after listing pagination', async () => {
  const calls = [];
  const result = await prepareMcp(async path => {
    calls.push(path);
    return path.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ title: `unrelated-${i}` })) : [namespace];
  }, config());
  assert.equal(result, config(namespace.id)); assert.equal(calls.length, 2);
});
test('creates only the named namespace on first deployment', async () => {
  const calls = [];
  assert.equal(await prepareMcp(async (path, method = 'GET', body) => {
    calls.push({ path, method, body }); return method === 'GET' ? [] : namespace;
  }, config()), config(namespace.id));
  assert.deepEqual(calls[1], { path: '/storage/kv/namespaces', method: 'POST', body: { title: 'plunge-oauth' } });
});
test('never replaces a configured namespace or ignores permission errors', async () => {
  await assert.rejects(prepareMcp(async () => [], config(namespace.id)), /not found/);
  await assert.rejects(prepareMcp(async () => [namespace], config('b'.repeat(32))), /different configuration/);
  await assert.rejects(prepareMcp(async () => { throw new Error('403'); }, config()), /403/);
});
