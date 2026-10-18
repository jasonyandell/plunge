import { OAuthProvider, AuthorizationError, CimdFetchError, insufficientScope,
  type OAuthHelpers, type OAuthResourceAuth, type AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { KVNamespace, ExecutionContext } from '@cloudflare/workers-types';
import app, { type Env as AppEnv } from './index';
import { accountSession, hashToken } from './accounts';
import { companionRequest, MCP_ORIGIN, MCP_RESOURCE, MCP_SCOPE, type Companion } from './mcp';
export { PlungeRoom } from './rooms';

interface Env extends AppEnv { OAUTH_KV?: KVNamespace; OAUTH_PROVIDER?: OAuthHelpers }
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const scopes = [MCP_SCOPE, 'offline_access'];
const redirect = (location: string, headers = new Headers()) => {
  headers.set('Location', location); headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 303, headers });
};
function page(title: string, content: string, headers = new Headers(), status = 200, formRedirect?: string): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  // same-origin preserves the Origin on same-site form POSTs without sending OAuth URLs to clients.
  headers.set('Cache-Control', 'no-store'); headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff'); headers.set('X-Frame-Options', 'DENY');
  // Chromium applies form-action to the callback redirect too. Allow only the validated client origin.
  const callback = formRedirect ? ` ${new URL(formRedirect).origin}` : '';
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${callback}; base-uri 'none'; frame-ancestors 'none'`);
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escape(title)} · Plunge</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f5f0e5;color:#27382e;font:18px/1.5 system-ui,sans-serif}
    main{max-width:36rem;margin:6vh auto;padding:1.5rem}h1{font:700 2.4rem/1.1 Georgia,serif}
    a{color:#245b42}label{display:block;font-weight:600}input{display:block;width:100%;padding:.8rem;font:inherit;margin:.5rem 0 1.4rem;border:1px solid #6a7b6c;border-radius:.4rem}
    button{font:inherit;cursor:pointer;padding:.75rem 1.15rem;border:1px solid #245b42;border-radius:2rem;background:#245b42;color:white;margin:.4rem .4rem .4rem 0}
    button.secondary{color:#245b42;background:transparent}section{padding:1rem 0;border-top:1px solid #c7cbbb}small{display:block;overflow-wrap:anywhere}strong{overflow-wrap:anywhere}
    </style><main><a href="/?account=1">← Your Plunge account</a><h1>${escape(title)}</h1>${content}</main></html>`, { status, headers });
}
function validRequest(auth: AuthRequest): boolean {
  const resources = auth.resource === undefined ? [] : Array.isArray(auth.resource) ? auth.resource : [auth.resource];
  return auth.codeChallengeMethod === 'S256' && /^[A-Za-z0-9_-]{43}$/.test(auth.codeChallenge ?? '')
    && resources.every(resource => resource === MCP_RESOURCE) && auth.scope.every(scope => scopes.includes(scope));
}
async function formBody(request: Request): Promise<URLSearchParams> {
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) throw new SyntaxError();
  const reader = request.body?.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
  if (reader) while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.length; if (size > 8192) { await reader.cancel(); throw new SyntaxError(); }
    text += decoder.decode(part.value, { stream: true });
  }
  return new URLSearchParams(text + decoder.decode());
}

async function consentRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), oauth = env.OAUTH_PROVIDER!;
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed.', { status: 405 });
  if (request.method === 'POST' && request.headers.get('Origin') !== MCP_ORIGIN) return new Response('Wrong origin.', { status: 403 });
  const account = await accountSession(request, env);
  if (!account) {
    if (request.method === 'POST') return page('Please sign in again', '<p>Return to your chat client and start connecting again.</p>', undefined, 401);
    // Validate first, even before sign-in. Never bounce an arbitrary URL through the account page.
    if (url.pathname === '/oauth/authorize' && !validRequest(await oauth.parseAuthRequest(request)))
      return page('Connection not supported', '<p>The client must use PKCE S256 and request Plunge access.</p>', undefined, 400);
    return redirect(`/?account=1&returnTo=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (url.pathname === '/oauth/connections') {
    if (request.method === 'POST') {
      const form = await formBody(request);
      if (form.get('account') !== account.id) return page('Account changed', '<p>Reload this page before disconnecting.</p>', undefined, 409);
      const grant = form.get('grant'); if (!grant) return new Response('Missing connection.', { status: 400 });
      // The library binds the grant to this user. Another user's identifier cannot revoke it.
      await oauth.revokeGrant(grant, account.id);
      return redirect('/oauth/connections');
    }
    const cursor = url.searchParams.get('cursor');
    const grants = await oauth.listUserGrants(account.id, { limit: 50, ...(cursor ? { cursor } : {}) });
    return page('Your chat companions', `<p>Connected by ${escape(account.name)}. Disconnect a companion to withdraw its access.</p>
      ${grants.items.map(grant => {
        const metadata = grant.metadata as { name?: string; clientName?: string; redirectHost?: string } | null;
        return `<section><h2>${escape(metadata?.name ?? 'Chat companion')}</h2>
          <p>${escape(metadata?.clientName ?? 'Chat client')}</p><small>${escape(metadata?.redirectHost ?? '')}</small>
          <form method="post"><input type="hidden" name="account" value="${escape(account.id)}"><input type="hidden" name="grant" value="${escape(grant.id)}">
          <button name="decision" value="disconnect">Disconnect</button></form></section>`;
      }).join('') || '<p>No chat companions are connected.</p>'}
      ${grants.cursor ? `<a href="/oauth/connections?cursor=${encodeURIComponent(grants.cursor)}">More connections →</a>` : ''}`);
  }
  if (request.method === 'GET') {
    const auth = await oauth.parseAuthRequest(request);
    if (!validRequest(auth)) return page('Connection not supported', '<p>The client must use PKCE S256 and request Plunge access.</p>', undefined, 400);
    const details = await oauth.describeConsent(auth), consent = await oauth.beginConsent(auth);
    const suggested = `${account.name}’s companion`.slice(0, 40);
    return page('Pull up a chair', `<p><strong>${escape(details.clientName)}</strong> wants to connect to Plunge with you, ${escape(account.name)}.</p>
      <p>${details.clientDomain ? `Published by <strong>${escape(details.clientDomain)}</strong>.` : 'This client supplied its own name; Plunge has not verified it.'}
      Access returns to <strong>${escape(details.redirectHost)}</strong>.</p>
      ${details.redirectIsLoopback ? '<p>This connects an app on your computer. Continue only if you just started connecting there.</p>' : ''}
      <p>Your companion gets its own name and player identity. This first connection can only read that identity. Playing and coaching will need additional permission when they become available.</p>
      <p>You can disconnect it from your account at any time. Connections expire after 30 days.</p>
      <form method="post" action="/oauth/authorize"><input type="hidden" name="handle" value="${escape(consent.handle)}">
      <input type="hidden" name="account" value="${escape(account.id)}">
      <label for="companion-name">Name at the table</label><input id="companion-name" name="name" maxlength="40" required value="${escape(suggested)}" autocomplete="off">
      <button name="decision" value="approve">Connect companion</button><button class="secondary" name="decision" value="deny" formnovalidate>Cancel</button></form>`, consent.headers, 200, details.redirectUri);
  }
  const form = await formBody(request);
  if (form.get('account') !== account.id) return page('Account changed', '<p>Start connecting again with the account you want to use.</p>', undefined, 409);
  const handle = form.get('handle') ?? '';
  if (form.get('decision') === 'deny') {
    const denied = await oauth.denyConsent(request, handle); return redirect(denied.redirectTo, denied.headers);
  }
  if (form.get('decision') !== 'approve') return new Response('Choose connect or cancel.', { status: 400 });
  const name = form.get('name')?.trim() ?? '';
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return page('Choose a name', '<p>Use a name of 1 to 40 characters, then start connecting again.</p>', undefined, 400);
  const approved = await oauth.approveConsent(request, handle);
  if (!validRequest(approved.request)) return new Response('Invalid connection.', { status: 400 });
  const details = await oauth.describeConsent(approved.request);
  const companion: Companion = { version: 1, ownerId: account.id, name,
    playerId: `companion_${await hashToken(`${account.id}\n${approved.request.clientId}`)}` };
  const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: account.id,
    metadata: { name, clientName: details.clientName, redirectHost: details.redirectHost },
    scope: [MCP_SCOPE, ...approved.request.scope.filter(scope => scope === 'offline_access')], props: companion });
  return redirect(redirectTo, approved.headers);
}

const provider = new OAuthProvider<Env>({
  apiRoute: '/api/mcp',
  apiHandler: { async fetch(request: Request, env: Env, ctx: unknown) {
    const { props, auth } = ctx as unknown as { props: Companion; auth: OAuthResourceAuth };
    if (!auth.scope.includes(MCP_SCOPE)) return insufficientScope(auth, [MCP_SCOPE]);
    if (props?.version !== 1 || auth.userId !== props.ownerId || !auth.clientId)
      return new Response('Reconnect this companion.', { status: 401 });
    // Consult the current account on every request. No account privileges are cached in the token.
    const owner = await env.QUESTIONS!.prepare('SELECT name FROM accounts WHERE id=?').bind(props.ownerId).first<{ name: string }>();
    if (!owner) return new Response('The connected account is unavailable.', { status: 401 });
    return companionRequest(request, props, owner.name);
  } },
  defaultHandler: { async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === '/oauth/authorize' || path === '/oauth/connections') {
      try { return await consentRequest(request, env); }
      catch (error) {
        if (error instanceof AuthorizationError || error instanceof CimdFetchError || error instanceof SyntaxError)
          return page('Please start connecting again', '<p>This connection request is invalid, expired, or already used. Return to your chat client to try again.</p>', undefined, 400);
        throw error;
      }
    }
    return new Response('Not found.', { status: 404 });
  } },
  authorizeEndpoint: '/oauth/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
  resourceMetadata: { resource: MCP_RESOURCE, authorization_servers: [MCP_ORIGIN], resource_name: 'Plunge Texas 42' },
  requiredScopes: [MCP_SCOPE], scopesSupported: scopes, clientIdMetadataDocumentEnabled: true,
  cookiePrefix: '__Host-plunge-oauth-', accessTokenTTL: 3600, refreshTokenTTL: 30 * 86400,
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const connection = url.pathname === '/api/mcp' || url.pathname.startsWith('/oauth/') || url.pathname.startsWith('/.well-known/oauth-');
    if (!connection) return app.fetch(request, env);
    if (url.origin !== MCP_ORIGIN || !env.OAUTH_KV || !env.QUESTIONS)
      return Response.json({ error: 'Chat connections are not configured on this deployment.' }, { status: 503 });
    // Remote chat services call server-to-server. A browser can only call from Plunge itself.
    const origin = request.headers.get('Origin');
    if (origin && origin !== MCP_ORIGIN) return new Response('Wrong origin.', { status: 403 });
    const response = await provider.fetch(request, env, ctx);
    const headers = new Headers(response.headers); headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
