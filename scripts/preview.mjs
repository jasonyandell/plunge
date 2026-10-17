/** PR-scoped Cloudflare resources. Never loads the production Wrangler config. */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Same-repository heads explicitly opt into the experimental room coordinator.
// Question storage remains device-only. Older local-only heads remain supported.
export const PREVIEW_PROTOCOL = 'family-rooms-v1';
export const LOCAL_ONLY_PROTOCOL = 'local-only-v1';
export const CONFIG_FILE = 'wrangler.preview.generated.json';
export const LOCAL_ONLY_MARKER = '<meta name="plunge-questions" content="local-only">';
export const ROOMS_MARKER = '<meta name="plunge-rooms" content="experimental">';
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
function expectedConfig(pr, protocol) {
  if (![PREVIEW_PROTOCOL, LOCAL_ONLY_PROTOCOL].includes(protocol)) throw new Error('Unsupported preview protocol.');
  return {
    name: names(pr).worker, main: 'worker/index.ts', compatibility_date: '2026-05-14',
    workers_dev: true, preview_urls: false,
    assets: { directory: './dist', binding: 'ASSETS', run_worker_first: ['/api/*'], not_found_handling: 'single-page-application' },
    ...(protocol === PREVIEW_PROTOCOL ? {
      durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'PlungeRoom' }] },
      migrations: [{ tag: 'family-rooms-v1', new_sqlite_classes: ['PlungeRoom'] }],
    } : {}),
  };
}
export function previewConfig(pr, protocol = PREVIEW_PROTOCOL) {
  return checkConfig(pr, expectedConfig(pr, protocol), protocol);
}
const sorted = value => Array.isArray(value) ? value.map(sorted)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
/** Exactly one PR Worker; only this protocol's own SQLite room binding is allowed. */
export function checkConfig(pr, config, protocol = PREVIEW_PROTOCOL) {
  if (JSON.stringify(sorted(config)) !== JSON.stringify(sorted(expectedConfig(pr, protocol))))
    throw new Error('Preview configuration must exactly match its database-free PR protocol (no production resources).');
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
    const text = await response.text();
    if (!text && response.ok && method === 'DELETE') return null;
    const value = JSON.parse(text);
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
export async function preparePreview(pr, api, protocol = PREVIEW_PROTOCOL) {
  const config = previewConfig(pr, protocol);
  const { subdomain } = await api('/workers/subdomain');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subdomain)) throw new Error('Unexpected workers.dev subdomain.');
  return { config, url: `https://${config.name}.${subdomain}.workers.dev` };
}
export async function cleanupPreview(pr, api) {
  const target = names(pr);
  // Cloudflare deletes namespaces implemented by this Worker with the Worker.
  // Do not force deletion through another Worker's references. A failed deletion
  // must not drop the legacy question DB either.
  await api(`/workers/scripts/${target.worker}`, 'DELETE', undefined, true);
  // Previews made before local-only mode each had a database; remove it if present.
  const database = await findDatabase(api, target.legacyDatabase);
  if (database) await api(`/d1/database/${databaseId(database, target.legacyDatabase)}`, 'DELETE', undefined, true);
}
export function stampPreview(pr, sha, protocol = PREVIEW_PROTOCOL) {
  names(pr);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('A full commit SHA is required.');
  // Never publish a build whose interface would offer uploads to a missing database.
  if (!readFileSync('dist/index.html', 'utf8').includes(LOCAL_ONLY_MARKER))
    throw new Error('Build with PLUNGE_QUESTIONS=local-only; this commit may predate local-only previews.');
  expectedConfig(pr, protocol);
  if (protocol === PREVIEW_PROTOCOL && !readFileSync('dist/index.html', 'utf8').includes(ROOMS_MARKER))
    throw new Error('Build with PLUNGE_ROOMS=experimental for the room preview.');
  writeFileSync('dist/version.json', JSON.stringify({ build: sha, preview_pr: Number(pr), questions: 'local-only',
    ...(protocol === PREVIEW_PROTOCOL ? { rooms: 'experimental' } : {}) }));
  writeFileSync('dist/robots.txt', 'User-agent: *\nDisallow: /\n');
  appendFileSync('dist/_headers', '\n/*\n  X-Robots-Tag: noindex, nofollow\n');
}
export async function smokePreview(url, sha, request = fetch, protocol = PREVIEW_PROTOCOL) {
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
  if (protocol === PREVIEW_PROTOCOL) {
    if (!html.includes(ROOMS_MARKER)) throw new Error('Preview app was not built for experimental rooms.');
    const rooms = await get('/api/rooms/status');
    if (!rooms.ok || (await rooms.json()).experimental !== true) throw new Error('Preview room coordinator is unavailable.');
  }
  // The Worker must refuse question storage rather than accept it anywhere.
  const questions = await get('/api/questions', { headers: { Authorization: `Bearer ${randomBytes(32).toString('hex')}` } });
  const body = await questions.json().catch(() => null);
  if (questions.status !== 503 || body?.local_only !== true) throw new Error('Preview question service is not local-only.');
}
async function main() {
  const [command, pr, value, selectedProtocol] = process.argv.slice(2);
  if (command === 'prepare') {
    const { config, url } = await preparePreview(pr, cloudflare(), value || PREVIEW_PROTOCOL);
    writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`);
    console.log(`Preview: ${url}`);
  } else if (command === 'check-config') {
    checkConfig(pr, JSON.parse(readFileSync(CONFIG_FILE, 'utf8')), value || PREVIEW_PROTOCOL);
    console.log(`${CONFIG_FILE} is a database-free preview for PR #${pr}.`);
  } else if (command === 'cleanup') {
    await cleanupPreview(pr, cloudflare());
    console.log(`Removed preview resources for PR #${pr}.`);
  } else if (command === 'stamp') {
    stampPreview(pr, value, selectedProtocol || PREVIEW_PROTOCOL);
  } else if (command === 'smoke') {
    for (let attempt = 1; ; attempt++) {
      try { await smokePreview(pr, value, fetch, selectedProtocol || PREVIEW_PROTOCOL); break; }
      catch (error) { if (attempt === 12) throw error; await delay(5000); }
    }
    console.log(`Verified app, commit, and local-only questions at ${pr}`);
  } else throw new Error('Usage: preview.mjs prepare|check-config|cleanup <pr> | stamp <pr> <sha> | smoke <url> <sha>');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
