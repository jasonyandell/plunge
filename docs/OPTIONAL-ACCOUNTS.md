# Optional passkey accounts

Plunge is free to anyone who likes 42, with no account, no real name and no
connection required. Signing in gives you more: your name and hands follow you
across devices and tables, and family can invite you to the family table and the
build section.

Ordinary play never requires signing in. A quiet **Sign in** in the corner of the
home screen (your name, once signed in; nothing at all on previews) opens the
account page, which offers **Sign in**, an **invite link** to paste, or a name field
and **Create an account**.
The browser/device handles its face, fingerprint, PIN, or screen-lock prompt.
There are no Apple/Google OAuth apps to register, client secrets to install,
passwords to manage, or provider redirects. Passkeys can be stored/synced by the
player's chosen password manager; availability on another device depends on that
manager and device. The existing private family invites remain an alternative.

Signing in identifies the account. Jason separately grants access to family ideas.
Every account has a stable random ID that its stats attach to (below).
Signing in does not upload game history, Walt receipts, or questions. Creating a
second account—even with the same name—creates a separate identity.

## Inviting family

Anyone with family access can invite someone from **Your account → Invite family**:
type their name and **Send an invite**. The phone's share sheet sends a one-use link
(`/?account=1#join=…`) that lasts a week. Behind it the server has already created
the account, named and with family access, but with no passkey, so it cannot sign
in until the link is used. The invited person opens it, sees *“Hi, Benny. Dad saved
you a seat at the family table,”* taps **Save my seat**, and their device makes the
passkey. The link is the proof of identity, because it went to them directly, so
nobody compares account numbers. Hands already on that device join the account,
and **Sit down at the family table** takes them straight there.

- The secret reuses the recovery machinery: an `account_recoveries` row with a
  week's expiry, claimed through the `recover` ceremony. Claiming an account with
  no passkey is the same as recovering one. Invites only ever create new
  accounts, so family members can't touch existing ones.
- **The home-screen app is separate.** On iPhone a link from Messages opens in
  Safari, whose storage and cookies are apart from the installed app. The passkey
  syncs, though, so the welcome page says: open Plunge from the home screen and tap
  **Sign in**; the app's own hands then join. Inside the installed app, **Have an
  invite link?** also accepts the pasted link directly.
- An invite opened in a browser already signed in as someone else says who it is
  for, and won't swap accounts unless that person signs out first.
- The inviter's list shows each invite as *Joined* or *Not yet · Send again*
  (a new link replaces the old one). Jason's panel shows who invited whom and
  can send a new link for an unused invite. Ten unused invites per person at most.
  `invited_by` on `accounts` (migration 0007) records who sent it.

The older request path below still works for someone who finds the app on their own.

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

## Stats

Every hand attempt a human played is recorded: finished hands, and the branches
left behind by a takeback or an abandoned game. Each is one `hands` row (the
recorder's record in `payload`, stored exactly as the client sent it, with the
engine replay of every bid, call and play, the app build and the exact Walt at
the table (player name, source commit, wasm hash); plus what SQL cannot read
from that replay: the deal key, whether it finished, bidder, bid, contract,
declaration, result, points and tricks per team, and the Walt setting for solo
play) and one `hand_players` row per human seat (account, device or name). The
server checks only the fields it decodes and strips nothing, so a client can
attach more detail (hints shown, receipts) without a server change; a record
is capped at 64 KB. A seat's team is `seat % 2`, so "won" is
`result_team = seat % 2`. Everyone who played the same deal shares `deal`. Walt's
own receipts and estimates never leave the device. The database is the merged
view; a leaderboard reads it directly.

- **Solo play.** The device keeps its hands log (`plunge-stats` in IndexedDB),
  one record per attempt under its branch id (`game:hand`, or
  `game-rN:hand` for a retry). While signed in, each hand is uploaded once with
  a random per-install device id and marked connected only after the service
  names it as stored; first write is kept and a repeat is acknowledged, never
  duplicated. Uploads happen after each hand, on focus and on reconnect, and
  only when something is pending; the upload is sent with `keepalive`. An idle
  tab sends nothing. Signed out, the one request comes back 401 and nothing is
  marked.
- **Greedy.** Whoever is signed in claims the device's hands: a second account
  on the same device gets them too, and a person's hands on every device are
  theirs. One seat can carry several accounts; nothing is ever refused.
- **Family rooms.** The room records each hand itself the moment it ends, and
  the branch a takeback leaves, with every human seat: a signed-in person's seat
  carries their account (read from the session cookie on create, join and
  reconnect), everyone else their name. No phone uploads anything. A failed
  write is kept in the room and retried on the next command or alarm.
- **The account page** uploads what is pending and shows the device's counts
  and the account's total across devices and rooms; **Connect now** repeats it.

`tests/stats-api.test.ts` covers the service, `tests/stats-sync.test.ts` the
device side against the real worker and D1, and `tests/room-stats.test.ts` a
room hand and its takeback recorded with their seats.

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
