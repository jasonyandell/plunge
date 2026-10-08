# Optional Apple and Google accounts

Regular Plunge play never requires an account. The home screen has a small
**Your account · optional** link. Sign-in identifies a person; it does not grant
family access, replace local saves, or upload existing game/history data.

Each account has a stable random `accounts.id` for future stats ownership. Nothing
collects or syncs stats in this change. Identity uses the provider and its verified
`sub`, not email or a chosen name. Apple and Google identities remain separate:
there is no automatic email matching or account linking in this first version.
Use the same provider on each device to reach the same account.

## What to set up

Configure only the stable main origin, **https://plunge.texas42.workers.dev**.
PR deployments deliberately have no account database or provider credentials.
Optional sign-in is unavailable there, with a link to the stable app. One provider
can be activated before the other; unconfigured choices remain disabled.

### Google

In Google Cloud's Google Auth Platform, configure the app audience, app name,
support/contact details, and required homepage/privacy information. Use an audience
that allows the family's Google accounts. While the consent app is in testing,
add each intended family member as a test user. Follow Google's current publishing
requirements before widening access.

Create an OAuth client of type **Web application**, with this authorized redirect URI:

```
https://plunge.texas42.workers.dev/api/account/callback/google
```

Save its client ID and client secret privately. This server-side authorization code
flow requests only `openid email profile`, uses PKCE, and does not request Google
Drive, contacts, calendars, or offline access. Google may briefly open its own
account chooser; the return URL goes back to the main Plunge account page.

Primary reference: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

### Apple

Apple's web flow requires a Services ID associated with a primary Apple App ID
that has Sign in with Apple enabled, plus the relevant Apple Developer account
access. A web-only project without that Apple setup cannot enable this by merely
adding a button.

1. Enable Sign in with Apple on the appropriate primary App ID.
2. Register/configure a Services ID for Plunge, associated with that primary App ID.
3. Register the domain `plunge.texas42.workers.dev` and this exact return URL:

   `https://plunge.texas42.workers.dev/api/account/callback/apple`

4. Create/download a Sign in with Apple private key. Save its `.p8` file, key ID,
   team ID, and Services ID securely. The Services ID is the web client ID.

The server generates a short-lived ES256 client secret from the private key for
each exchange, avoiding manual six-month JWT renewals. Apple uses a form POST
callback; a short-lived Secure/HttpOnly/SameSite=None browser-binding cookie and
single-use stored state protect this cross-site return. The permanent Plunge
session is Secure/HttpOnly/SameSite=Lax and expires after 30 days. Apple relay
emails work as contact labels; neither email nor the player-chosen name grants
access. Players can enter “Mom” or “Dad” on their account page.

Primary references: [Apple web setup](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web),
[Apple authorization flow](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server).

## Install configuration without putting secrets in source

Create a private JSON file **outside the repository**, with permissions `0600`.
Provide the full pair for Google, the full group for Apple, or both groups:

```json
{
  "GOOGLE_CLIENT_ID": "your Google web client ID",
  "GOOGLE_CLIENT_SECRET": "your Google client secret",
  "APPLE_CLIENT_ID": "your Apple Services ID",
  "APPLE_TEAM_ID": "your Apple team ID",
  "APPLE_KEY_ID": "your Apple key ID",
  "APPLE_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
}
```

The key is the actual PKCS#8 PEM text, with JSON newlines, not a filename.
Omit an entire provider group if setting up only the other provider. Do not paste
secrets into chat, commit them, or put them in browser build variables.

From the repository, run:

```
node scripts/accounts-admin.mjs install-config /absolute/path/to/private-login.json
```

This validates the shape and saves `PLUNGE_SOCIAL_LOGIN_CONFIG` as a GitHub Actions
secret through stdin. The trusted **main** deployment applies the database migration
and installs provider values as Worker secrets only after tests/build. Preview and
CI jobs never receive them. Configuration alone does not deploy an unmerged PR.
Removing a provider from the JSON does not delete an already-installed Worker secret;
to disable an active provider, delete its client ID secret from the main Worker and
remove its complete group from the saved GitHub secret so the next deploy does not
restore it. Rotate any compromised secret in the provider console as well.

## Make Jason the owner, then grant Mom and Dad

No first-user-is-admin rule and no email allowlist grants ownership.

1. Deploy the reviewed account implementation and configured provider(s) to main.
2. Jason signs in using his chosen provider and saves a recognizable name.
3. From the private machine with the existing builder configuration, run:

   `node scripts/accounts-admin.mjs list`

4. Identify Jason's exact account by provider, email, and account ID, then run:

   `node scripts/accounts-admin.mjs owner ACCOUNT_ID`

5. Refresh Jason's **Your account** page. It now includes the family access panel.
6. Mom and Dad sign in, enter their names, and choose **Ask for family access**.
7. Jason refreshes requests and chooses **Grant family access** for each verified
   person. They choose **Check access**, then **Open family ideas**.

New relatives follow the same flow. **Remove family access** takes effect on
subsequent requests without deleting their account, cards, or conversation history.
Regranting preserves their identity and authorship. Existing private invites remain
available for people who prefer them; social login is optional even for invited
family members. Signing out clears this browser's account session and remembered
legacy invite. It does not delete game saves.

The command-line equivalents are `grant ACCOUNT_ID` and `revoke ACCOUNT_ID`.
Owner bootstrapping is available only with the private builder credential. The
browser owner panel can grant family access but cannot promote another owner.

## Verification and remaining activation work

Tests use real D1 SQL, generated signing keys, and mocked provider endpoints to
exercise signature/issuer/audience/nonce/expiry checks, PKCE and state binding,
callback replay, separate same-email identities, guest play, grants, revocation,
CSRF, session expiry, logout, and private preview isolation. UI checks cover the
optional guest path, profile/request/grant flow, and phone layout.

Real Google/Apple consent and an installed iPhone return cannot be verified until
provider configuration exists. In particular, check return-to-installed-app behavior
on Mom's and Dad's devices: the provider's account chooser is the necessary external
step, and some operating systems may return it to the browser rather than the PWA.
The in-app preview flow never sends account cookies to PR origins. Stats linking,
account linking between providers, and recovery/deletion UI are follow-up features,
not claims made by this first launch.

Button art is served locally, from Google's [official pre-approved asset bundle](https://developers.google.com/identity/branding-guidelines)
and Apple's `appleid.cdn-apple.com/appleid/button` generator. Loading the account
page itself does not load provider scripts or contact Apple/Google.

UI regression command: `node scripts/test-accounts-browser.mjs` against the default
build served on local port 4178. Navigation regression command:
`node scripts/test-ideas-navigation.mjs` against the same build.
