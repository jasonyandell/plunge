# Family ideas

Mom and Dad can use optional passkey accounts with family access granted by
Jason, or keep using a personal invite. [Account setup](OPTIONAL-ACCOUNTS.md) covers
passkey enrollment, owner setup, recovery, and grants. **Ideas for Plunge** opens
large, simple cards inside the existing app. They can create another idea at any
time, reply on either person's card, and try an individual change. No GitHub
account is needed. **Try your change** opens the preview inside the existing app,
under a compact **Back to your idea** bar. It does not open another tab or replace
the installed app. Back/Forward, reload, and direct preview links keep the card
address; unsent replies stay saved. Only previews currently marked ready can open.
The embedded preview is isolated on its own origin, with top-level navigation and
popups blocked. Preview game saves remain separate from the regular game.
Temporary previews do not offer installation or register an offline app.

Conversations live in new tables in the existing production D1 database, separate
from game questions and temporary preview Workers. Closing a PR does not delete
an idea. Everyone with a valid family invite or a signed-in account granted family access
can read and reply to the board.
Invite keys are random, hashed in D1, sent in Authorization headers, and removable
individually. Invite links carry their key in a fragment, which is removed from
the address bar immediately. Browser storage remembers that invite and unsent
drafts. Anyone who receives the invite can use it; keep it within the family.

## Automatic builder

`scripts/ideas/builder.mjs` runs one queued conversation per invocation using the
Mac's existing Codex CLI ChatGPT sign-in and GitHub CLI login. It is intended to
be called by a visible Codex scheduled task. The Mac must be awake and connected;
otherwise cards remain queued. There is no always-on cloud agent in this version.
Official reference: <https://learn.chatgpt.com/docs/non-interactive-mode>.

The service atomically claims a card with a three-minute lease. The coordinator
renews it every thirty seconds. Each claim captures a conversation boundary;
family replies arriving afterward automatically queue another pass. Repeated
client writes, claim retries, and finish retries are idempotent. An expired
builder cannot finish another builder's job.

For each run the coordinator:

1. Clones Plunge into its own checkout and continues that idea's open branch, or
   creates `codex/idea-<opaque id>` from current `main`. A follow-up after a closed
   or merged PR gets a new branch based on main.
2. Runs `codex exec` with a workspace-write sandbox, network disabled, structured
   output and no inherited user config. Family discussion is quoted as data.
3. Accepts changes only under `src/ui`, `src/room`, `src/engine`, and `tests`.
   Infrastructure, dependencies, the builder and its credentials cannot be
   published by this path. Requests outside that scope become a question for
   Jason to pick up. This intentionally starts with game/UI changes.
4. Runs typecheck, the complete application test suite, and a production build.
   Only passing changes are committed and pushed. GitHub credentials stay with
   the coordinator; the agent has no publishing task. It creates a draft PR and
   never merges one. PR titles and implementation summaries are public; the
   original family conversation stays in the private board.
5. On subsequent invocations, checks GitHub tests and deployment. The service
   independently fetches that PR's fixed `version.json` and checks both the PR
   number and exact commit before showing **Ready to try**. **In the game** waits
   for the merge commit, or its descendant, to be live on production.

A failed build becomes **Needs attention**, with its conversation intact. A reply
queues a retry. A request needing clarification becomes **A question for you**.
A local process lock avoids overlapping scheduler runs. Full requests, model
JSONL, test output, source checkouts, result files and publication receipts are
retained under `~/.local/share/plunge-ideas/runs/`. These contain private family
text; they are not repository files. Stop the scheduled task to stop new builds.
Do not delete an active run directory.

## Activation

The production workflow only deploys main. Review and merge this implementation
when ready to publish; it applies `0002_family_ideas.sql` using the existing deployment path.
It creates no extra database. Until the private builder key is installed, the
ideas endpoint stays unavailable and accepts no submissions.

Before merging, prepare the builder key from this checkout:

```sh
codex login status
node scripts/ideas/admin.mjs init
node scripts/ideas/admin.mjs install-secret
```

After merging and a successful main deployment:

```sh
node scripts/ideas/admin.mjs invite Mom
node scripts/ideas/admin.mjs invite Dad
node scripts/ideas/builder.mjs
```

`init` writes a mode-600 configuration in `~/.config/plunge-ideas/config.json`.
`install-secret` saves it as the GitHub Actions secret `PLUNGE_IDEAS_ADMIN_TOKEN`
through stdin, never command arguments or output. The main deployment job installs
it as a Worker secret after tests/build, using the existing scoped Cloudflare
deployment credentials. It is never available to preview jobs or application tests.
This also avoids depending on a separately signed-in Cloudflare CLI on the Mac. `invite`
writes each personal link to a mode-600 file next to that configuration; share
that file's link directly with its intended person. For the installed PWA,
**Ideas for Plunge** accepts pasting the invite, so it works when the OS opens an
external link in a different browser. `revoke MEMBER_ID` disables one invite.
No privileged credential is bundled in the browser or deployed to PR previews.

Create a Codex heartbeat to run the builder every five minutes from a stable
checkout. Keep it quiet when there is no work; notify Jason about failures and
completed previews. Attach any PR URL returned by the builder to that chat.
The task invokes the script, not a second free-form implementation of these
steps. Runs can exceed five minutes; the scheduler and local lock serialize them.

Optional `PLUNGE_IDEAS_CONFIG` selects a private config file for local tests.
A config's `origin` must be production or localhost. `stateDir` selects a private
run archive. `onlyIdea` can restrict a diagnostic invocation to one card id.
These settings never come from family text.

## Verify locally

```sh
npm run build
npm run db:local
# Put IDEAS_ADMIN_TOKEN=<random 64-hex value> in ignored .dev.vars.
npx wrangler dev --port 8791
node scripts/test-ideas-browser.mjs
npx vitest run tests/ideas-api.test.ts
node --test scripts/test-ideas-builder.mjs scripts/test-preview.mjs
```

The browser test only accepts localhost because it creates fixture conversations.
It uses separate Mom and Dad browser sessions, multiple ideas, per-card drafts,
offline retry and 320/390-pixel phone layouts. Service integration tests use real
Miniflare D1 for ownership, retry, racing claims, replies during builds, lease
expiry, exact preview identity, stale publication and revocation.

### Bidding walkthrough

Open `/?ideas=1&demo=bidding` for a browser-only demo, also linked from the preview's Ideas page. It starts with an explicitly labeled sample conversation about keeping your bid visible and embeds the existing PR #22 playable preview. Mom/Dad switching, replies, new cards, and drafts are stored under separate `plunge:ideas-demo:*` / `plunge:ideas-demo-draft:*` browser keys. This route does not read invites, call the ideas service, or start builds. PR #22 must remain deployed for the playable part; its link is separate from this walkthrough's PR.

Validated the demo at 390px and 320px: draft reload, both family identities replying, new-card persistence, playable preview bidding, return to conversation, and zero ideas API requests.

### In-app preview navigation checks

Build with `npm run build`, serve with `npm run preview -- --host 127.0.0.1 --port 4178`, then run `node scripts/test-ideas-navigation.mjs`. This uses intercepted idea fixtures and the deployed PR #22 game in Chromium and WebKit. It covers phone layout, actual bidding inside the frame, one app/tab, saved drafts and replies, Back/Forward/reload, direct links, and expired readiness. The browser checks are not physical installed-iPhone validation.
