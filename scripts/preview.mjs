/** PR-scoped Cloudflare resources. Never loads the production Wrangler config. */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// The preview workflow runs a PR's own tools only when they declare this protocol:
// previews have no database; questions stay in the browser that saved them.
export const PREVIEW_PROTOCOL = 'local-only-v1';
export const CONFIG_FILE = 'wrangler.preview.generated.json';
export const LOCAL_ONLY_MARKER = '<meta name="plunge-questions" content="local-only">';
const CONFIG_KEYS = ['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'assets'];
export function names(pr) {
  if (!/^[1-9][0-9]{0,8}$/.test(String(pr))) throw new Error('A positive PR number is required.');
  // The database name only identifies resources made by earlier previews, for cleanup.
  return { worker: `plunge-pr-${pr}`, legacyDatabase: `plunge-pr-${pr}-questions` };
}
function databaseId(database, expectedName) {
  if (database?.name !== expectedName || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(database.uuid))
    throw new Error('Unexpected preview database identity.');
  return database.uuid;
}
export function previewConfig(pr) {
  return checkConfig(pr, {
    name: names(pr).worker, main: 'worker/index.ts', compatibility_date: '2026-05-14',
    workers_dev: true, preview_urls: false,
    assets: { directory: './dist', binding: 'ASSETS', run_worker_first: ['/api/*'], not_found_handling: 'single-page-application' },
  });
}
/** Only a PR-named Worker serving assets: no bindings, routes or production identity. */
export function checkConfig(pr, config) {
  const extra = Object.keys(config ?? {}).filter(key => !CONFIG_KEYS.includes(key));
  if (config?.name !== names(pr).worker || extra.length || config.workers_dev !== true || config.preview_urls !== false
    || config.assets?.binding !== 'ASSETS' || Object.keys(config.assets).length !== 4)
    throw new Error(`Preview configuration must be a database-free Worker${extra.length ? ` (unexpected: ${extra.join(', ')})` : ''}.`);
  return config;
}
export function cloudflare({ account = process.env.CLOUDFLARE_ACCOUNT_ID,
  token = process.env.CLOUDFLARE_API_TOKEN, request = fetch } = {}) {
  if (!account || !token) throw new Error('Cloudflare deployment credentials are required.');
  return async (path, method = 'GET', body, allowMissing = false) => {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (allowMissing && response.status === 404) return null;
    const value = await response.json();
    if (!response.ok || !value.success) {
      // Do not print headers or response bodies containing account details.
      throw new Error(`Cloudflare ${method} ${path} failed (${response.status}; codes: ${(value.errors ?? []).map(e => e.code).join(',')}).`);
    }
    return value.result;
  };
}
async function findDatabase(api, name) {
  for (let page = 1; page <= 100; page++) {
    const databases = await api(`/d1/database?per_page=100&page=${page}`);
    const found = databases.find(database => database.name === name);
    if (found) return found;
    if (databases.length < 100) return null;
  }
  throw new Error('Database listing exceeded the pagination limit.');
}
/** Read-only: looks up the workers.dev subdomain. Creates and migrates nothing. */
export async function preparePreview(pr, api) {
  const config = previewConfig(pr);
  const { subdomain } = await api('/workers/subdomain');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subdomain)) throw new Error('Unexpected workers.dev subdomain.');
  return { config, url: `https://${config.name}.${subdomain}.workers.dev` };
}
export async function cleanupPreview(pr, api) {
  const target = names(pr);
  // Remove serving code first. A failed Worker deletion must not drop its DB.
  await api(`/workers/scripts/${target.worker}`, 'DELETE', undefined, true);
  // Previews made before local-only mode each had a database; remove it if present.
  const database = await findDatabase(api, target.legacyDatabase);
  if (database) await api(`/d1/database/${databaseId(database, target.legacyDatabase)}`, 'DELETE', undefined, true);
}
export function stampPreview(pr, sha) {
  names(pr);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('A full commit SHA is required.');
  // Never publish a build whose interface would offer uploads to a missing database.
  if (!readFileSync('dist/index.html', 'utf8').includes(LOCAL_ONLY_MARKER))
    throw new Error('Build with PLUNGE_QUESTIONS=local-only; this commit may predate local-only previews.');
  writeFileSync('dist/version.json', JSON.stringify({ build: sha, preview_pr: Number(pr), questions: 'local-only' }));
  writeFileSync('dist/robots.txt', 'User-agent: *\nDisallow: /\n');
  appendFileSync('dist/_headers', '\n/*\n  X-Robots-Tag: noindex, nofollow\n');
}
export async function smokePreview(url, sha, request = fetch) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/^plunge-pr-[1-9][0-9]*\.[a-z0-9-]+\.workers\.dev$/.test(parsed.hostname))
    throw new Error('Smoke checks require a PR preview URL.');
  const get = (path, options = {}) => request(new URL(path, parsed), {
    ...options, cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  const version = await get(`/version.json?check=${sha}`);
  if (!version.ok || (await version.json()).build !== sha) throw new Error('Preview is not serving the expected commit yet.');
  const page = await get('/');
  const html = page.ok ? await page.text() : '';
  if (!html.includes('<script')) throw new Error('Preview app is unavailable.');
  if (!html.includes(LOCAL_ONLY_MARKER)) throw new Error('Preview app was not built for local-only questions.');
  // The Worker must refuse question storage rather than accept it anywhere.
  const questions = await get('/api/questions', { headers: { Authorization: `Bearer ${randomBytes(32).toString('hex')}` } });
  const body = await questions.json().catch(() => null);
  if (questions.status !== 503 || body?.local_only !== true) throw new Error('Preview question service is not local-only.');
}
async function main() {
  const [command, pr, value] = process.argv.slice(2);
  if (command === 'prepare') {
    const { config, url } = await preparePreview(pr, cloudflare());
    writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`);
    console.log(`Preview: ${url}`);
  } else if (command === 'check-config') {
    checkConfig(pr, JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
    console.log(`${CONFIG_FILE} is a database-free preview for PR #${pr}.`);
  } else if (command === 'cleanup') {
    await cleanupPreview(pr, cloudflare());
    console.log(`Removed preview resources for PR #${pr}.`);
  } else if (command === 'stamp') {
    stampPreview(pr, value);
  } else if (command === 'smoke') {
    for (let attempt = 1; ; attempt++) {
      try { await smokePreview(pr, value); break; }
      catch (error) { if (attempt === 12) throw error; await delay(5000); }
    }
    console.log(`Verified app, commit, and local-only questions at ${pr}`);
  } else throw new Error('Usage: preview.mjs prepare|check-config|cleanup <pr> | stamp <pr> <sha> | smoke <url> <sha>');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
