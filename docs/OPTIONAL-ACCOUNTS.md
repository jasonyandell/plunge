# Optional passkey accounts

Ordinary play never requires signing in. **Your account · optional** on the home
screen offers **Sign in with a passkey**, or a name field and **Create an account**.
The browser/device handles its face, fingerprint, PIN, or screen-lock prompt.
There are no Apple/Google OAuth apps to register, client secrets to install,
passwords to manage, or provider redirects. Passkeys can be stored/synced by the
player's chosen password manager; availability on another device depends on that
manager and device. The existing private family invites remain an alternative.

Signing in identifies the account. Jason separately grants access to family ideas.
Every account has a stable random ID that owns its finished-hand stats (below).
Signing in does not upload game history, Walt receipts, or questions. Creating a
second account—even with the same name—creates a separate identity.

## Launch and add family

1. Merge/deploy the reviewed PR. The normal deployment applies the account tables
   to the existing database. No extra account-service credentials are needed.
2. Jason opens **Your account**, enters his name, and creates a passkey.
3. In **Account and sign-in help**, Jason finds his account number. On the private
   machine that already has the family builder configuration, run:

   `node scripts/accounts-admin.mjs list`

4. Match Jason's exact account number, then run once:

   `node scripts/accounts-admin.mjs owner ACCOUNT_ID`

5. Refresh Jason's account page. It now includes the family access panel.
6. Mom, Dad, and other relatives create their optional accounts, then choose
   **Ask for family access**.
7. Confirm their account numbers with them and choose **Grant family access**.
   Names alone are not proof of identity. They choose **Check access**, then
   **Open family ideas**.

There is no first-person-is-admin rule. The private admin helper bootstraps the
owner; the browser panel grants family access but cannot promote other owners.
**Remove family access** takes effect on subsequent requests without deleting an
account or its conversations. Regranting keeps its original identity/authorship.
Command-line equivalents are `grant ACCOUNT_ID` and `revoke ACCOUNT_ID`.

## Finished-hand stats

Every finished hand, solo or family room, is one `hands` row (the replay, the
deal key, bidder, bid, contract, declaration, result, points and tricks per
team, marks before and after, practice and thrown-in flags, and the recorder's
record verbatim in `payload`) plus one `hand_players` row per seat (`human` with
account, device or name; `walt` with the Walt version when known). A player's
team is `seat % 2`, so "won" is `result_team = seat % 2`. Everyone who played
the same deal shares `deal`. The worker reads every fact from the replay
itself; Walt's own receipts and estimates never leave the device. The database
is the merged view; a leaderboard reads it directly.

- **Solo play.** The device keeps its finished-hand log (`plunge-stats` in
  IndexedDB). While signed in, each hand is uploaded once with a random
  per-install device id and marked connected only after the service names it
  as stored; first write is kept, a repeat is acknowledged, never duplicated,
  and a hand another account connected first stays there. The game uploads
  after each finished hand, every 30 seconds, on focus and on reconnect, and
  only when something is pending: an idle or signed-out tab makes no request.
  The upload is sent with `keepalive`. An ended session is noticed on the next
  upload and the device goes quiet until the account page signs in again.
- **Family rooms.** The room records each finished hand itself the moment it
  ends, with all four seats: a signed-in person's seat carries their account
  (set by the worker from the session cookie on create, join and reconnect; a
  client cannot supply it), everyone else by name, empty seats as Walt. No
  phone uploads anything. A failed write is kept in the room and retried on
  the next command or alarm. A hand with a takeback in it is practice and is
  not recorded, as in solo play.
- **The account page** uploads what is pending and shows the device's counts
  and the account's total across devices and rooms; **Connect now** repeats it.

`tests/stats-api.test.ts` covers the service, `tests/stats-sync.test.ts` the
device side against the real worker and D1, and `tests/room-stats.test.ts` a
room hand recorded with its seats.

## Passkeys and the stable install

Passkeys are scoped to the exact main hostname `plunge.texas42.workers.dev`, with
expected origin `https://plunge.texas42.workers.dev`. Keep this hostname stable;
moving accounts to another hostname would require a deliberate credential migration.
Temporary PR builds cannot enroll/sign in, have no account database, and link back
to the main account page. Embedded previews never receive the main app's cookies.

Discoverable credentials and user verification are required. The server verifies
challenge, origin, RP ID, signature, user handle, and credential counter through
SimpleWebAuthn. Enrollment uses no identifying attestation. One-use challenges are
stored server-side, tied to a Secure/HttpOnly host-only browser cookie, and expire
after five minutes. Every browser mutation requires the main app's Origin header.
Sessions are hashed server-side and use Secure/HttpOnly/SameSite=Lax host-only
cookies with a 30-day lifetime. Signing out removes this browser's session and
remembered legacy invite, while leaving game saves alone.

While signed in, **Account and sign-in help → Add another passkey** can add another
supported authenticator/password manager to the same account. A browser may refuse
a duplicate registration of its existing passkey; that passkey can already sign in.
Up to ten passkeys can be attached to an account.

## If someone loses access

First try a saved/synced passkey on another device. If that fails:

1. Jason confirms the person's identity and the correct existing account through
   the family's trusted contact channel. Do not create a new replacement account.
2. In the family panel, open **Help recover this account → Make recovery link**.
3. Share the link privately with that person. It expires after 15 minutes, works
   once, and grants the ability to replace the account's passkeys. Creating another
   recovery link invalidates the previous one.
4. The person opens it in the main app and chooses **Create replacement passkey**.
5. After the new passkey verifies, the server replaces the old passkeys and revokes
   existing sessions. The account ID, family grant, and ideas remain unchanged.

The secret is in the URL fragment (not server logs or a query string); the app removes
it from the visible address immediately and keeps it only for that visit. Reloading
before completion requires reopening the private link. An unsuccessful passkey
verification does not consume the recovery link. It never grants new family access.

Recovering an owner requires the private helper, not the browser panel:

`node scripts/accounts-admin.mjs recover ACCOUNT_ID`

It writes the link to a private `0600` file alongside the existing builder
configuration rather than printing the secret. The same helper works for a family
member. Keep that private admin configuration available for owner recovery.

## Verification and limits

`npm test` includes real D1 SQL and cryptographic passkey fixtures. Tests exercise
registration, login signatures, wrong site/RP/challenge, missing user verification,
wrong user handles, replay/counters, session expiry, family permissions, extra
passkeys, recovery replay/expiry, and revocation of old keys/sessions.

After `npm run build`, `node scripts/test-accounts-browser.mjs` uses Chromium's
virtual authenticator, the real account handler, and a fresh temporary D1 database.
It intercepts all browser HTTPS traffic locally and contacts no deployed service.
It exercises actual browser enrollment, login, additional-passkey registration,
recovery, owner grants, guest play, and 320px/390px layouts. It requires Node 22.18+
and the Playwright Chromium browser. `node scripts/test-ideas-navigation.mjs`
checks the separate embedded-preview flow against a local server on port 4178.

Virtual authenticators are not physical-device verification. Before family launch,
check enrollment, cancellation, returning sign-in, recovery, and installed-app
behavior on Mom's and Dad's actual devices. Account deletion and the scoring
screen are separate future work. The replaced social-login configuration was never activated;
no Apple or Google app configuration is required for this version.

References: [SimpleWebAuthn server](https://simplewebauthn.dev/docs/packages/server),
[SimpleWebAuthn browser](https://simplewebauthn.dev/docs/packages/browser),
[Passkeys overview](https://passkeys.dev/docs/intro/what-are-passkeys/).
