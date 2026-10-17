# Production KV setup

The production Worker has two separate bindings:

| Binding | Namespace | Purpose |
| --- | --- | --- |
| `OAUTH_KV` | `plunge-oauth` | Persistent chat-client registrations and grants |
| `IDEAS_CACHE` | `plunge-ideas-cache` | Disposable cache available to future ideas features |

The repository variable `PLUNGE_DEPLOY_PROFILE` defaults to `core`. Core releases
omit both KV bindings and skip KV provisioning, keeping ordinary releases usable
while credentials are pending. Profile selection always runs first. A `companions`
release requires the dedicated KV secret and stops on any provisioning failure.

`scripts/prepare-kv.mjs` finds or creates these exact namespaces during companion deployment.
It never deletes namespaces or replaces a configured non-placeholder identity.
It validates both bindings before creating resources. A failed provisioning step
stops deployment. PR previews have neither binding and receive no KV credential.
The ideas cache is infrastructure only; the board does not use it yet.

## Bootstrap from the Mac's admin credential

The local helper reads `cloudflare-global-key` from macOS Keychain, including its
account email. Run it in Terminal where Keychain can request user approval:

```sh
python3 scripts/setup-kv-token.py
```

This default mode only reads. It verifies the `texas42` Workers subdomain and the
existing `plunge-questions` database before selecting an account and resolving
the current Workers KV write permission ID. Keychain access failure is distinct
from a rejected or expired Cloudflare credential: if retrieval fails, no
Cloudflare request is made.

To perform setup:

```sh
python3 scripts/setup-kv-token.py --apply
```

The helper asks Cloudflare to issue a user token with **Workers KV Storage Write**
on that single account, verifies the new token, creates or reuses the two
namespaces, and passes the secret directly to `gh secret set` through stdin.
The new secret is `CLOUDFLARE_KV_API_TOKEN` in `jasonyandell/plunge`. No admin key
or token is printed, passed as a process argument, or saved in a local file.
The global key stays in Keychain and is never installed in GitHub or the Worker.
Cloudflare must accept the issuing credential for its token-creation API; a
rejected request stops setup and does not fall back to copying the global key.

The KV credential has account-wide KV write scope, since namespace provisioning
needs account scope. It has no token-creation, DNS, D1, or Worker-deployment
permission. Runtime code uses Worker bindings and needs no API credential.
The existing deployment secret is preserved. If KV secret installation fails,
only the newly created token is revoked; namespaces are preserved. If revocation
also fails, the helper prints only the token ID for cleanup. Existing KV secrets
are never silently replaced; inspect them before a deliberate rotation.

After this change is on main, `--apply --deploy` installs and verifies the KV
credential and namespaces, then sets `PLUNGE_DEPLOY_PROFILE=companions` and
dispatches production deployment. A failed setup cannot switch the profile.
`--apply` alone leaves the release profile unchanged. If setup already succeeded,
enable companions and deploy separately only after verifying that setup:

```sh
gh variable set PLUNGE_DEPLOY_PROFILE --body companions --repo jasonyandell/plunge
gh workflow run deploy.yml --repo jasonyandell/plunge --ref main
```

Check Actions and the live Worker before claiming setup is deployed. A successful
local test cannot verify Cloudflare token issuance, GitHub installation, or native
chat-client OAuth. Live token issuance remains unverified until Keychain permits
access and Cloudflare accepts the request.

References: [Cloudflare token creation](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/),
[KV namespace creation](https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/methods/create/).
