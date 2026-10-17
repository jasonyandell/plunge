# Chat companions: connection milestone

Production releases use the GitHub repository variable `PLUNGE_DEPLOY_PROFILE`.
It defaults to `core`: the game, family accounts, rooms and idea board deploy with
the existing deployment credential. The release omits the OAuth and optional
ideas-cache KV bindings; no namespace is deleted. The same authenticated Worker
entrypoint serves ordinary routes and returns 503 for companion routes until
storage is configured. `/version.json` reports `companions: false`.

After the companion task installs and verifies the KV credential, set the variable
to `companions` and deploy. That profile requires KV provisioning to succeed;
permission errors never silently downgrade a companion release. Keep the variable
set for subsequent releases. Profile selection runs before provisioning, and only
companion releases load the dedicated KV credential and prepare both namespaces.

The Texas 42 MCP endpoint is `https://plunge.texas42.workers.dev/api/mcp`.
This first milestone authenticates a named companion and exposes **`get_player`**.
It does not yet join rooms, read a hand, run Walt, coach, send table talk, or play.

## Connecting

Add the endpoint as a custom remote MCP server in the chat client's settings.
Use OAuth; client registration is automatic. Follow the sign-in link, use your
existing Plunge passkey, and continue to the consent page. Check the client and
the destination shown there, choose your companion's name, and connect.
Ask the chat to call `get_player` to confirm the connection.

Your passkey stays with your authenticator. The chat service holds its own
revocable OAuth tokens, not your passkey, Plunge session cookie, room token, or
owner credentials. A companion has a different identity from the human who
connected it. Different client registrations and different people get separate
identities. Reconnecting the same client keeps that identity; a new client
registration gets a new identity.

Disconnect from **Your account → Your chat companions**, or visit
`https://plunge.texas42.workers.dev/oauth/connections`. Access tokens last one
hour; refresh grants last 30 days. Revocation uses Workers KV, whose propagation
can take time across locations; do not promise instantaneous global logout.

As checked against official documentation on October 17, 2026:

- [ChatGPT custom MCP connection](https://developers.openai.com/plugins/deploy/connect-chatgpt)
  and [OAuth requirements](https://developers.openai.com/plugins/build/auth).
  This server supports both dynamic registration and client ID metadata documents.
  Access to custom servers depends on the account and workspace policy.
- [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
  can be connected through its settings and used on supported mobile clients.
- [Gemini custom MCP connections](https://support.google.com/gemini/answer/17209137?hl=en-PR)
  are set up on the web and usable on mobile. Google's documented eligibility
  includes US personal accounts, age 18+, English, and Keep Activity enabled.
  Write actions currently require confirmation.

Documentation support is not a successful connection test. Record each actual
client/account/device verification separately before calling it compatible.

## Architecture and boundaries

`worker/mcp-entry.ts` wraps the existing Worker only for MCP and OAuth routes.
Cloudflare's OAuth provider handles registration, discovery, PKCE, token
encryption/hashing, refresh and revocation. Passkey sign-in remains the existing
account flow. Consent is browser-bound, expires in ten minutes and is consumed
on approval or denial. The form checks the signed-in account has not changed.
Client strings are escaped, consent pages forbid framing, and the service worker
does not cache or substitute the game shell for OAuth pages.

Only `plunge:profile` is granted. The MCP handler enforces it and checks that the
owner account still exists on every call. No family or owner authority transfers
to the companion. Future game tools need additional scopes and explicit consent.
No client runtime or persistent sandbox is required to connect.

Walt can later run through a separate adapter in a capable client sandbox, in a
human's browser, or on a service. Validate actual runtime/network support and
measured latency for each route. Give it only the acting seat's observation.
Do not expose a live deal seed or the current family room's full four-hand state
to a competing model. Existing browser rooms trust their participants with that
full state; that protocol is not suitable as the companion observation API.

## Deployment and validation

Companion-profile deployment runs `scripts/prepare-kv.mjs` to find or create the
`plunge-oauth` KV namespace and resolve its `OAUTH_KV` binding. The same step
resolves a separate `plunge-ideas-cache` namespace as `IDEAS_CACHE`. It uses the
dedicated GitHub secret `CLOUDFLARE_KV_API_TOKEN`. A missing or invalid KV token
stops the companion release. KV setup needs **Workers KV Storage: Edit** on the
existing account. The subsequent Worker deployment keeps its existing credential.
Namespace setup failure stops deployment. Never delete OAuth storage to repair
a connection or clear the ideas cache. See [KV setup](KV-SETUP.md) for the local
admin-key bootstrap and its verification boundaries.

PR previews continue using the database-free `worker/index.ts` entry and cannot
authenticate companions. Production routes also fail closed without both account
storage and OAuth storage, or on an origin other than the existing passkey RP.

Run `npm run typecheck`, `npm test`, `node --test scripts/test-prepare-kv.mjs`,
`npm run build`, `node scripts/test-mcp-browser.mjs` and `npm run deploy:dry-run`. `tests/mcp-api.test.ts` exercises
the actual bundled Worker in Miniflare with D1/KV: discovery, registration,
consent, PKCE, MCP calls, identity isolation, refresh, revocation and rejected
cross-origin, cross-account, redirect, resource and permission requests.
The account suite separately checks real WebAuthn signatures. These tests do
not substitute for approving the connection in each native chat client.
The browser check uses an isolated test account and a loopback callback, follows
the account continuation, approves consent and disconnects at phone widths.
