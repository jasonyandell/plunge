import { test } from 'node:test';
import assert from 'node:assert/strict';
import { names, previewConfig, preparePreview, cleanupPreview, cloudflare, smokePreview } from './preview.mjs';

const previewDb = { name: 'plunge-pr-4-questions', uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
const productionDb = { name: 'plunge-questions', uuid: '11111111-2222-3333-4444-555555555555' };
function fixture({ exists = false, failDelete = false } = {}) {
  let databases = [productionDb, ...(exists ? [previewDb] : [])];
  const calls = [];
  return { calls, api: async (path, method = 'GET', body) => {
    calls.push({ path, method, body });
    if (path === '/workers/subdomain') return { subdomain: 'test-account' };
    if (path.startsWith('/d1/database?')) return databases;
    if (path === '/d1/database' && method === 'POST') { databases.push(previewDb); return previewDb; }
    if (path === '/workers/scripts/plunge-pr-4' && method === 'DELETE') {
      if (failDelete) throw new Error('permission denied');
      return null;
    }
    if (path === `/d1/database/${previewDb.uuid}` && method === 'DELETE') {
      databases = databases.filter(d => d !== previewDb); return null;
    }
    throw new Error(`Unexpected API access: ${method} ${path}`);
  } };
}
test('invalid identities cannot select production or perform API calls', async () => {
  for (const pr of ['', 'main', '0', '-4', '04', '4/../plunge', '4\n', undefined]) {
    assert.throws(() => names(pr));
    const f = fixture();
    await assert.rejects(preparePreview(pr, f.api));
    await assert.rejects(cleanupPreview(pr, f.api));
    assert.equal(f.calls.length, 0);
  }
  assert.throws(() => previewConfig(4, productionDb), /identity/);
});
test('first deployment provisions only this PR; repeat deployment retains its database', async () => {
  const f = fixture();
  const first = await preparePreview(4, f.api);
  const second = await preparePreview(4, f.api);
  assert.deepEqual(first, second);
  assert.equal(first.url, 'https://plunge-pr-4.test-account.workers.dev');
  assert.equal(first.config.d1_databases[0].database_id, previewDb.uuid);
  assert.equal(first.config.name, 'plunge-pr-4');
  assert.equal(first.config.routes, undefined);
  assert.equal(first.config.preview_urls, false);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('database lookup follows pagination before provisioning', async () => {
  const filler = Array.from({ length: 100 }, (_, i) => ({ name: `another-${i}` }));
  const api = async path => {
    if (path === '/workers/subdomain') return { subdomain: 'test-account' };
    if (path.endsWith('page=1')) return filler;
    if (path.endsWith('page=2')) return [previewDb];
    throw new Error('Must not create a duplicate database');
  };
  assert.equal((await preparePreview(4, api)).config.d1_databases[0].database_id, previewDb.uuid);
});
test('cleanup removes only this PR, is repeatable, and never deletes production', async () => {
  const f = fixture({ exists: true });
  await cleanupPreview(4, f.api);
  await cleanupPreview(4, f.api);
  assert.deepEqual(f.calls.filter(c => c.method === 'DELETE').map(c => c.path), [
    '/workers/scripts/plunge-pr-4', `/d1/database/${previewDb.uuid}`, '/workers/scripts/plunge-pr-4',
  ]);
});
test('failed Worker cleanup retains its database', async () => {
  const f = fixture({ exists: true, failDelete: true });
  await assert.rejects(cleanupPreview(4, f.api), /permission denied/);
  assert.equal(f.calls.length, 1);
});
test('API allows missing cleanup targets but does not hide auth/server failures', async () => {
  for (const status of [403, 404, 500]) {
    const api = cloudflare({ account: 'test', token: 'secret', request: async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 10007 }] }), { status }) });
    if (status === 404) assert.equal(await api('/workers/scripts/plunge-pr-4', 'DELETE', undefined, true), null);
    else await assert.rejects(api('/workers/scripts/plunge-pr-4', 'DELETE', undefined, true));
  }
});
test('smoke check refuses production and detects stale code or missing database', async () => {
  const sha = 'a'.repeat(40), url = 'https://plunge-pr-4.test-account.workers.dev';
  const request = async (input, options) => {
    if (input.pathname === '/version.json') return Response.json({ build: sha });
    if (input.pathname === '/') return new Response('<script src="/app.js"></script>');
    assert.match(options.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
    return Response.json({ items: [] });
  };
  await smokePreview(url, sha, request);
  await assert.rejects(smokePreview('https://plunge.test-account.workers.dev', sha, request), /preview URL/);
  await assert.rejects(smokePreview(url, 'b'.repeat(40), request), /expected commit/);
  await assert.rejects(smokePreview(url, sha, async (input, options) => input.pathname === '/api/questions'
    ? Response.json({ error: 'unavailable' }, { status: 503 }) : request(input, options)), /database/);
});
