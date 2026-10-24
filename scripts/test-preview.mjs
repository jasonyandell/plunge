import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { names, previewConfig, checkConfig, preparePreview, cleanupPreview, cloudflare, smokePreview, stampPreview,
  LOCAL_ONLY_MARKER, ROOMS_MARKER, PREVIEW_PROTOCOL, LOCAL_ONLY_PROTOCOL } from './preview.mjs';

const previewDb = { name: 'plunge-pr-4-questions', uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
const productionDb = { name: 'plunge-questions', uuid: '11111111-2222-3333-4444-555555555555' };
function fixture({ exists = false, failDelete = false } = {}) {
  let databases = [productionDb, ...(exists ? [previewDb] : [])];
  const calls = [];
  return { calls, api: async (path, method = 'GET', body) => {
    calls.push({ path, method, body });
    if (path === '/workers/subdomain') return { subdomain: 'test-account' };
    if (path.startsWith('/d1/database?')) return databases;
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
test('preview deploys never touch D1 and always build and check a local-only preview', () => {
  const workflow = readFileSync(new URL('../.github/workflows/preview.yml', import.meta.url), 'utf8');
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'), workflow.indexOf('\n  cleanup:'));
  assert.ok(deploy.length > 100);
  const commands = deploy.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(commands, /\bd1\b|migrations/i);
  assert.match(deploy, /PLUNGE_QUESTIONS=local-only npm run build/);
  assert.match(deploy, /PLUNGE_ROOMS="\$PREVIEW_ROOMS"/);
  assert.match(deploy, /wrangler deploy --config wrangler\.preview\.generated\.json/);
  assert.match(deploy, /\.\.\/preview-tools\/scripts\/preview\.mjs check-config/);
  // The workflow's grep must select these tools, and reject tools that predate them.
  const pattern = /marker="(\^.+)\\\$"/.exec(deploy)?.[1] + '$';
  assert.equal(pattern, `^export const PREVIEW_PROTOCOL = '${PREVIEW_PROTOCOL}';$`);
  const grep = text => spawnSync('grep', ['-q', pattern], { input: text }).status;
  assert.equal(grep(readFileSync(new URL('./preview.mjs', import.meta.url))), 0);
  assert.equal(grep("export const CONFIG_FILE = 'wrangler.preview.generated.json';\n"), 1);
  assert.equal(grep("// export const PREVIEW_PROTOCOL = 'local-only-v1';\n"), 1);
  // Production keeps its database.
  assert.match(readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
    /wrangler d1 migrations apply QUESTIONS --remote\n\s+node scripts\/ideas\/install-secret\.mjs\n\s+npx wrangler deploy\n/);
  assert.doesNotMatch(readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'), /PLUNGE_QUESTIONS/);
});
test('invalid identities cannot select production or perform API calls', async () => {
  for (const pr of ['', 'main', '0', '-4', '04', '4/../plunge', '4\n', undefined]) {
    assert.throws(() => names(pr));
    const f = fixture();
    await assert.rejects(preparePreview(pr, f.api));
    await assert.rejects(cleanupPreview(pr, f.api));
    assert.equal(f.calls.length, 0);
  }
});
test('production enables its own room namespace while preserving question database identity', () => {
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(config, /^name = "plunge"/);
  assert.match(config, /database_name = "plunge-questions"\ndatabase_id = "98730843-94b0-4507-b3c1-91fb12f0702a"/);
  assert.match(config, /\[\[durable_objects.bindings\]\]\nname = "ROOMS"\nclass_name = "PlungeRoom"/);
  assert.match(config, /new_sqlite_classes = \["PlungeRoom"\]/);
  assert.doesNotMatch(config, /script_name|plunge-pr-/);
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /PLUNGE_ROOMS=experimental npm run build/);
  assert.doesNotMatch(workflow, /\bdelete\b|\bcleanup\b/);
});
test('preparing a preview only reads the subdomain and never creates or binds a database', async () => {
  const f = fixture();
  const first = await preparePreview(4, f.api);
  assert.deepEqual(first, await preparePreview(4, f.api));
  assert.equal(first.url, 'https://plunge-pr-4.test-account.workers.dev');
  assert.equal(first.config.name, 'plunge-pr-4');
  assert.equal(first.config.d1_databases, undefined);
  assert.equal(first.config.routes, undefined);
  assert.equal(first.config.preview_urls, false);
  assert.deepEqual(first.config.durable_objects, { bindings: [{ name: 'ROOMS', class_name: 'PlungeRoom' }] });
  assert.deepEqual(first.config.migrations, [{ tag: 'family-rooms-v1', new_sqlite_classes: ['PlungeRoom'] }]);
  assert.deepEqual(f.calls.map(c => `${c.method} ${c.path}`), ['GET /workers/subdomain', 'GET /workers/subdomain']);
});
test('generated configuration rejects bindings, routes and other workers', () => {
  const config = previewConfig(4);
  assert.equal(checkConfig(4, config), config);
  for (const bad of [
    { ...config, d1_databases: [{ binding: 'QUESTIONS', database_name: productionDb.name, database_id: productionDb.uuid }] },
    { ...config, routes: ['plunge.example/*'] },
    { ...config, kv_namespaces: [] },
    { ...config, vars: { QUESTIONS: 'x' } },
    { ...config, name: 'plunge' },
    { ...config, workers_dev: false },
    { ...config, assets: { ...config.assets, binding: 'QUESTIONS' } },
    { ...config, assets: { ...config.assets, directory: '/production' } },
    { ...config, main: 'worker/another.ts' },
    { ...config, durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'PlungeRoom', script_name: 'plunge' }] } },
    { ...config, migrations: [{ tag: 'family-rooms-v1', new_classes: ['PlungeRoom'] }] },
  ]) assert.throws(() => checkConfig(4, bad), /database-free/);
  assert.throws(() => checkConfig(5, config));
});
test('older local-only heads keep exactly their own configuration without rooms', () => {
  const local = previewConfig(4, LOCAL_ONLY_PROTOCOL);
  assert.equal(local.durable_objects, undefined);
  assert.equal(local.migrations, undefined);
  assert.equal(checkConfig(4, local, LOCAL_ONLY_PROTOCOL), local);
  assert.throws(() => checkConfig(4, local, PREVIEW_PROTOCOL));
  assert.throws(() => checkConfig(4, previewConfig(4), LOCAL_ONLY_PROTOCOL));
});
test('cleanup removes this PR and its legacy database, is repeatable, and never deletes production', async () => {
  const f = fixture({ exists: true });
  await cleanupPreview(4, f.api);
  await cleanupPreview(4, f.api);
  assert.deepEqual(f.calls.filter(c => c.method === 'DELETE').map(c => c.path), [
    '/workers/scripts/plunge-pr-4', `/d1/database/${previewDb.uuid}`, '/workers/scripts/plunge-pr-4',
  ]);
});
test('cleanup without a legacy database deletes only the Worker', async () => {
  const f = fixture();
  await cleanupPreview(4, f.api);
  assert.deepEqual(f.calls.filter(c => c.method !== 'GET').map(c => c.path), ['/workers/scripts/plunge-pr-4']);
  assert.ok(f.calls.every(c => !c.path.includes('force=') && !c.path.includes('durable_objects')));
});
test('legacy database lookup follows pagination', async () => {
  const filler = Array.from({ length: 100 }, (_, i) => ({ name: `another-${i}` }));
  const deleted = [];
  await cleanupPreview(4, async (path, method = 'GET') => {
    if (method === 'DELETE') { deleted.push(path); return null; }
    if (path.endsWith('page=1')) return filler;
    if (path.endsWith('page=2')) return [previewDb];
    throw new Error(`Unexpected API access: ${method} ${path}`);
  });
  assert.deepEqual(deleted, ['/workers/scripts/plunge-pr-4', `/d1/database/${previewDb.uuid}`]);
});
test('failed Worker cleanup retains its database', async () => {
  const f = fixture({ exists: true, failDelete: true });
  await assert.rejects(cleanupPreview(4, f.api), /permission denied/);
  assert.equal(f.calls.length, 1);
});
test('API allows missing cleanup targets but does not hide auth/server failures', async () => {
  for (const status of [200, 204]) {
    const empty = cloudflare({ account: 'test', token: 'secret', request: async () => new Response(null, { status }) });
    assert.equal(await empty('/workers/scripts/plunge-pr-4', 'DELETE'), null);
  }
  for (const status of [403, 404, 500]) {
    const api = cloudflare({ account: 'test', token: 'secret', request: async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 10007 }] }), { status }) });
    if (status === 404) assert.equal(await api('/workers/scripts/plunge-pr-4', 'DELETE', undefined, true), null);
    else await assert.rejects(api('/workers/scripts/plunge-pr-4', 'DELETE', undefined, true));
  }
});
test('stamping refuses a build that would offer uploads', () => {
  const home = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'plunge-preview-'));
  try {
    process.chdir(dir); mkdirSync('dist');
    writeFileSync('dist/_headers', '/assets/*\n  Cache-Control: immutable\n');
    writeFileSync('dist/index.html', '<meta name="plunge-questions" content="remote"><script></script>');
    assert.throws(() => stampPreview(4, 'a'.repeat(40)), /local-only/);
    writeFileSync('dist/index.html', `${LOCAL_ONLY_MARKER}<script></script>`);
    assert.throws(() => stampPreview(4, 'a'.repeat(40)), /experimental/);
    stampPreview(4, 'a'.repeat(40), LOCAL_ONLY_PROTOCOL);
    writeFileSync('dist/index.html', `${LOCAL_ONLY_MARKER}${ROOMS_MARKER}<script></script>`);
    assert.throws(() => stampPreview(4, 'short'), /SHA/);
    stampPreview(4, 'a'.repeat(40));
    assert.deepEqual(JSON.parse(readFileSync('dist/version.json', 'utf8')),
      { build: 'a'.repeat(40), preview_pr: 4, questions: 'local-only', rooms: 'experimental' });
    assert.match(readFileSync('dist/_headers', 'utf8'), /X-Robots-Tag: noindex/);
  } finally { process.chdir(home); rmSync(dir, { recursive: true, force: true }); }
});
test('smoke check refuses production and detects stale code, remote builds, or a question database', async () => {
  const sha = 'a'.repeat(40), url = 'https://plunge-pr-4.test-account.workers.dev';
  const request = async (input, options) => {
    if (input.pathname === '/version.json') return Response.json({ build: sha });
    if (input.pathname === '/') return new Response(`${LOCAL_ONLY_MARKER}${ROOMS_MARKER}<script src="/app.js"></script>`);
    if (input.pathname === '/api/rooms/status') return Response.json({ experimental: true });
    assert.match(options.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
    return Response.json({ error: 'This preview keeps questions on your device only.', local_only: true }, { status: 503 });
  };
  const replace = (path, response) => async (input, options) => input.pathname === path ? response() : request(input, options);
  await smokePreview(url, sha, request);
  await assert.rejects(smokePreview('https://plunge.test-account.workers.dev', sha, request), /preview URL/);
  await assert.rejects(smokePreview(url, 'b'.repeat(40), request), /expected commit/);
  await assert.rejects(smokePreview(url, sha, replace('/', () => new Response('<script></script>'))), /local-only/);
  await assert.rejects(smokePreview(url, sha, replace('/', () => new Response(`${LOCAL_ONLY_MARKER}<script></script>`))), /experimental/);
  await assert.rejects(smokePreview(url, sha, replace('/api/rooms/status', () => Response.json({ experimental: false }))), /coordinator/);
  await assert.rejects(smokePreview(url, sha, replace('/api/questions', () => Response.json({ items: [] }))), /not local-only/);
  await assert.rejects(smokePreview(url, sha, replace('/api/questions',
    () => Response.json({ error: 'Questions are temporarily unavailable.' }, { status: 503 }))), /not local-only/);
});

test('family builder keys are confined to the main deployment step', () => {
  const deploy=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
  const preview=readFileSync(new URL('../.github/workflows/preview.yml',import.meta.url),'utf8');
  assert.match(deploy,/if: github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(preview,/IDEAS_ADMIN_TOKEN|SOCIAL_LOGIN_CONFIG|install-secret|install-login-config/);
  const steps=deploy.split('      - name: Prepare question database and deploy');
  assert.doesNotMatch(steps[0],/IDEAS_ADMIN_TOKEN|SOCIAL_LOGIN_CONFIG/);
  assert.match(steps[1],/PLUNGE_IDEAS_ADMIN_TOKEN: \$\{\{ secrets.PLUNGE_IDEAS_ADMIN_TOKEN \}\}/);
});
