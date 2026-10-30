import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { hashToken } from '../worker/accounts';
import { connectionReturn } from '../src/account/connection';

const origin = 'https://plunge.texas42.workers.dev', resource = `${origin}/api/mcp`;
const redirectUri = 'https://chat.example.test/oauth/callback';
const metadataClient = 'https://chat.example.test/oauth/client.json';
const alice = { id: 'a'.repeat(32), token: 'a'.repeat(64), name: 'Alice' };
const bob = { id: 'b'.repeat(32), token: 'b'.repeat(64), name: 'Bob' };
const cookie = (user = alice) => `__Host-plunge-session=${user.token}`;
let mf: Miniflare, unconfigured: Miniflare;
const request = (path: string, init: NonNullable<Parameters<Miniflare['dispatchFetch']>[1]> = {}) => mf.dispatchFetch(`${origin}${path}`, { redirect: 'manual', ...init });
const form = (path: string, body: Record<string, string>, cookies = '', extra: Record<string, string> = {}) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: cookies, ...extra },
  body: new URLSearchParams(body).toString(),
});
const field = (html: string, name: string) => html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1] ?? '';
const b64 = (value: ArrayBuffer) => Buffer.from(value).toString('base64url');
beforeAll(async () => {
  const bundled = await build({ entryPoints: ['worker/mcp-entry.ts'], bundle: true, write: false, format: 'esm',
    platform: 'browser', conditions: ['workerd'], external: ['cloudflare:workers'] });
  const options = { modules: true, script: bundled.outputFiles![0]!.text, compatibilityDate: '2026-05-14',
    compatibilityFlags: ['global_fetch_strictly_public'], serviceBindings: { ASSETS: async () => new Response('Game works') } };
  mf = new Miniflare({ ...options, kvNamespaces: ['OAUTH_KV'], d1Databases: ['QUESTIONS'],
    outboundService: async (request: { url: string }) => request.url === metadataClient ? Response.json({
      client_id: metadataClient, client_name: 'Metadata chat', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none',
    }) : new Response('No external network in this test.', { status: 404 }) });
  unconfigured = new Miniflare({ ...options, d1Databases: ['QUESTIONS'], bindings: { IDEAS_ADMIN_TOKEN: 'd'.repeat(64) } });
  const db = await mf.getD1Database('QUESTIONS');
  const sql = await readFile(new URL('../migrations/0002_family_ideas.sql', import.meta.url), 'utf8');
  const [tables, trigger] = sql.split('CREATE TRIGGER');
  for (const statement of tables!.split(';').filter(s => s.trim())) await db.prepare(statement).run();
  await db.prepare(`CREATE TRIGGER${trigger}`).run();
  for (const statement of (await readFile(new URL('../migrations/0003_accounts.sql', import.meta.url), 'utf8')).split(';').filter(s => s.trim()))
    await db.prepare(statement).run();
  // Existing account tests perform real WebAuthn signatures. Here, start at the resulting signed-in session.
  for (const user of [alice, bob]) {
    await db.prepare('INSERT INTO accounts(id,name,created) VALUES(?,?,?)').bind(user.id, user.name, Date.now()).run();
    await db.prepare('INSERT INTO account_sessions(hash,account_id,expires) VALUES(?,?,?)')
      .bind(await hashToken(user.token), user.id, Date.now() + 3600000).run();
  }
}, 20000);
afterAll(async () => { await Promise.all([mf?.dispose(), unconfigured?.dispose()]); });

async function start(user = alice, clientName = 'Test chat', changes: Record<string, string> = {}) {
  const registration = await request('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  expect(registration.status).toBe(201);
  const client = await registration.json() as { client_id: string };
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const params = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
    resource, scope: 'plunge:profile offline_access', state: 'client-state', code_challenge_method: 'S256',
    code_challenge: b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))), ...changes });
  const path = `/oauth/authorize?${params}`;
  const consent = await request(path, { headers: { Cookie: cookie(user) } });
  const html = await consent.text();
  const binding = consent.headers.get('Set-Cookie')?.split(';')[0] ?? '';
  return { client: { client_id: params.get('client_id')! }, verifier, path, consent, html, handle: field(html, 'handle'), cookies: `${cookie(user)}; ${binding}`, user };
}
async function approve(flow: Awaited<ReturnType<typeof start>>, changes: Record<string, string> = {}, cookies = flow.cookies) {
  return form('/oauth/authorize', { handle: flow.handle, account: flow.user.id, name: 'Luna & friends', decision: 'approve', ...changes }, cookies);
}
async function token(flow: Awaited<ReturnType<typeof start>>, code: string, changes: Record<string, string> = {}) {
  return form('/oauth/token', { grant_type: 'authorization_code', client_id: flow.client.client_id, code,
    redirect_uri: redirectUri, code_verifier: flow.verifier, resource, ...changes });
}
async function connect(user = alice) {
  const flow = await start(user); expect(flow.consent.status).toBe(200);
  const approval = await approve(flow); expect(approval.status).toBe(303);
  const callback = new URL(approval.headers.get('Location')!);
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  expect(callback.searchParams.get('state')).toBe('client-state');
  const issued = await token(flow, callback.searchParams.get('code')!); expect(issued.status).toBe(200);
  const tokens = await issued.json() as { access_token: string; refresh_token: string; scope: string };
  return { ...flow, ...tokens };
}
async function rpc(accessToken: string, method: string, params: unknown = {}) {
  const response = await request('/api/mcp', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const text = await response.text();
  const data = response.status === 200 ? JSON.parse(text.startsWith('event:') ? text.split('\n').find(line => line.startsWith('data:'))!.slice(5) : text) as Record<string, any> : null;
  return { response, data, text };
}

it('advertises OAuth discovery, protects MCP, and leaves ordinary play available', async () => {
  expect(await (await request('/')).text()).toBe('Game works');
  const challenge = await request('/api/mcp'); expect(challenge.status).toBe(401);
  expect(challenge.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  const metadataUrl = challenge.headers.get('WWW-Authenticate')!.match(/resource_metadata="([^"]+)"/)![1]!;
  const metadata = await (await mf.dispatchFetch(metadataUrl)).json();
  expect(metadata).toMatchObject({ resource, authorization_servers: [origin], scopes_supported: ['plunge:profile'] });
  expect(await (await request('/.well-known/oauth-authorization-server')).json()).toMatchObject({
    authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`, code_challenge_methods_supported: ['S256'],
  });
  expect((await unconfigured.dispatchFetch(resource)).status).toBe(503);
  expect((await mf.dispatchFetch('https://plunge-pr-1.texas42.workers.dev/api/mcp')).status).toBe(503);
  expect((await request('/api/mcp', { headers: { Origin: 'https://evil.test' } })).status).toBe(403);
});

it('keeps core play and board authentication intact without companion storage', async () => {
  expect(await (await unconfigured.dispatchFetch(`${origin}/`)).text()).toBe('Game works');
  expect((await unconfigured.dispatchFetch(`${origin}/api/ideas`)).status).toBe(401);
  expect((await unconfigured.dispatchFetch(`${origin}/api/ideas/admin/cards`)).status).toBe(403);
  for (const path of ['/api/mcp', '/oauth/register', '/oauth/authorize', '/.well-known/oauth-authorization-server'])
    expect((await unconfigured.dispatchFetch(`${origin}${path}`)).status).toBe(503);
});

it('routes sign-in back only to a local consent or management page', async () => {
  const flow = await start();
  const signIn = await request(flow.path); expect(signIn.status).toBe(303);
  const next = new URL(signIn.headers.get('Location')!, origin).searchParams.get('returnTo');
  expect(connectionReturn(next, origin)).toBe(flow.path);
  expect(connectionReturn('/oauth/connections', origin)).toBe('/oauth/connections');
  for (const path of ['//evil.test/oauth/authorize', '/\\evil.test/oauth/authorize', 'https://evil.test', 'javascript:alert(1)', '/api/account', '/oauth/authorize/../token'])
    expect(connectionReturn(path, origin)).toBeNull();
});

it('escapes client names and requires a browser-bound, one-use consent with the same signed-in account', async () => {
  const flow = await start(alice, '<script>alert(1)</script>');
  expect(flow.html).not.toContain('<script>'); expect(flow.html).toContain('&#60;script&#62;');
  expect(flow.html).toContain('chat.example.test'); expect(flow.html).toContain('Plunge has not verified');
  expect(flow.consent.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  expect((await approve(flow, {}, cookie())).status).toBe(400);
  expect((await form('/oauth/authorize', { handle: flow.handle, account: alice.id, name: 'Bot', decision: 'approve' }, flow.cookies, { Origin: 'https://evil.test' })).status).toBe(403);
  expect((await approve(flow, {}, flow.cookies.replace(cookie(), cookie(bob)))).status).toBe(409);
  expect((await approve(flow)).status).toBe(303);
  expect((await approve(flow)).status).toBe(400);
});

it('rejects unregistered redirects, wrong resources, unknown permissions, and missing or plain PKCE', async () => {
  for (const changes of [
    { redirect_uri: 'https://evil.test/callback' }, { resource: 'https://evil.test/mcp' },
    { scope: 'plunge:play' }, { code_challenge_method: 'plain' }, { code_challenge: '' },
  ]) {
    const flow = await start(alice, 'Test chat', changes); expect(flow.consent.status).toBe(400);
    expect(flow.consent.headers.get('Location')).toBeNull();
  }
});

it('returns cancellation to the registered client without issuing access', async () => {
  const flow = await start(); const denied = await approve(flow, { decision: 'deny' });
  expect(denied.status).toBe(303);
  const callback = new URL(denied.headers.get('Location')!);
  expect(callback.searchParams.get('error')).toBe('access_denied');
  expect(callback.searchParams.get('state')).toBe('client-state');
  expect(callback.searchParams.has('code')).toBe(false);
  expect((await approve(flow)).status).toBe(400);
});

it('requires the PKCE verifier, binds the token audience and consumes authorization codes once', async () => {
  const flow = await start(), approval = await approve(flow);
  const code = new URL(approval.headers.get('Location')!).searchParams.get('code')!;
  expect((await token(flow, code, { code_verifier: 'z'.repeat(43) })).status).toBe(400);
  expect((await token(flow, code, { resource: 'https://evil.test/mcp' })).status).toBe(400);
  const valid = await token(flow, code); expect(valid.status).toBe(200);
  expect((await token(flow, code)).status).toBe(400);
});

it('connects a client ID metadata document with its verified publishing domain', async () => {
  const flow = await start(alice, 'Ignored registration', { client_id: metadataClient });
  expect(flow.consent.status).toBe(200);
  expect(flow.html).toContain('Published by <strong>chat.example.test</strong>');
  expect(flow.html).toContain('Metadata chat');
  const approved = await approve(flow); expect(approved.status).toBe(303);
  const issued = await token(flow, new URL(approved.headers.get('Location')!).searchParams.get('code')!);
  expect(issued.status).toBe(200);
  const tokens = await issued.json() as { access_token: string };
  expect((await rpc(tokens.access_token, 'tools/list')).response.status).toBe(200);
});

it('serves the current per-request MCP protocol alongside the 2025 client handshake', async () => {
  const connection = await connect();
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' } };
  for (const method of ['server/discover', 'tools/list', 'tools/call']) {
    const response = await request('/api/mcp', { method: 'POST', headers: { Authorization: `Bearer ${connection.access_token}`,
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': 'get_player' } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { _meta: meta,
        ...(method === 'tools/call' ? { name: 'get_player', arguments: {} } : {}) } }) });
    expect(response.status).toBe(200);
    const value = await response.json() as { result?: unknown; error?: unknown };
    expect(value.error).toBeUndefined(); expect(value.result).toBeDefined();
  }
});

it('speaks MCP with distinct per-owner and per-client companion identities and no gameplay authority', async () => {
  const a = await connect(), b = await connect(bob), another = await connect();
  const initialized = await rpc(a.access_token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  expect(initialized.data?.result.serverInfo.name).toBe('texas-42');
  const listed = await rpc(a.access_token, 'tools/list');
  expect(listed.data?.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['get_player']);
  const ids = new Set<string>();
  for (const [connection, name] of [[a, 'Alice'], [b, 'Bob'], [another, 'Alice']] as const) {
    const result = await rpc(connection.access_token, 'tools/call', { name: 'get_player', arguments: {} });
    expect(result.response.status).toBe(200);
    const profile = result.data?.result.structuredContent;
    expect(profile).toMatchObject({ player: { name: 'Luna & friends', kind: 'companion' }, connectedBy: name,
      capabilities: { identity: true, gameplay: false, coaching: false } });
    expect(result.text).not.toContain(connection.user.id); expect(result.text).not.toContain(connection.user.token);
    ids.add(profile.player.id);
  }
  expect(ids.size).toBe(3);
  const invalid = await rpc(a.access_token, 'tools/call', { name: 'get_player', arguments: { ownerId: bob.id } });
  expect(invalid.data?.result?.isError || invalid.data?.error).toBeTruthy();
  expect((await rpc(cookie(), 'tools/list')).response.status).toBe(401);
  expect(await (await request('/api/account', { headers: { Authorization: `Bearer ${a.access_token}` } })).json())
    .toMatchObject({ account: null, available: true });
});

it('refreshes connections and lets only the approving account revoke them', async () => {
  const connection = await connect();
  const refreshed = await form('/oauth/token', { grant_type: 'refresh_token', client_id: connection.client.client_id,
    refresh_token: connection.refresh_token, resource });
  expect(refreshed.status).toBe(200);
  const tokens = await refreshed.json() as { access_token: string; refresh_token: string };
  const management = await request('/oauth/connections', { headers: { Cookie: cookie() } });
  const html = await management.text(); expect(html).toContain('Luna &#38; friends');
  // Pick the latest connection by its saved grant's metadata and token's user/grant prefix.
  const grant = tokens.access_token.split(':')[1]!; expect(grant).toBeTruthy();
  expect(html).toContain(grant);
  const other = await form('/oauth/connections', { account: bob.id, grant }, cookie(bob));
  expect([303, 400]).toContain(other.status);
  expect((await rpc(tokens.access_token, 'tools/list')).response.status).toBe(200);
  expect((await form('/oauth/connections', { account: alice.id, grant }, cookie(), { Origin: 'https://evil.test' })).status).toBe(403);
  expect((await form('/oauth/connections', { account: alice.id, grant }, cookie())).status).toBe(303);
  expect((await rpc(tokens.access_token, 'tools/list')).response.status).toBe(401);
  expect((await form('/oauth/token', { grant_type: 'refresh_token', client_id: connection.client.client_id,
    refresh_token: tokens.refresh_token, resource })).status).toBe(400);
});
