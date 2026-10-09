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
Mac's existing Codex CLI ChatGPT sign-in and GitHub CLI login. It explicitly
selects `gpt-6-astra` with `high` reasoning and records the requested settings in
each run's `model.json`. Private `codexPath` can select a dedicated current CLI;
this Mac uses `~/.local/share/plunge-ideas/runtime/node_modules/.bin/codex` so an
older shell CLI cannot silently choose the model. It is intended to
be called by ordinary local scheduling code. This Mac uses a LaunchAgent every
15 seconds, with no model invocation for an empty queue. The Mac must be awake,
logged in, and connected;
otherwise cards remain queued. There is no always-on cloud agent in this version.
Official reference: <https://learn.chatgpt.com/docs/non-interactive-mode>.

The service atomically claims a card with a three-minute lease. The coordinator
renews it every thirty seconds. Each claim captures a conversation boundary;
family replies arriving afterward automatically queue another pass. Repeated
client writes, claim retries, and finish retries are idempotent. An expired
builder cannot finish another builder's job.

Each card and its conversation show **Working now** while the latest check-in is
less than 75 seconds old, with its age below. After that the label becomes
**No recent update**; browser connection failures show **Updates unavailable**.
Waiting for a reply, queued work, preview checks, and completed builds have
separate labels. This is coordinator liveness while making/testing a change, not
a token-level model activity meter. The page polls every five seconds and ages its
last observation locally, with reduced-motion support. It uses the existing lease
and heartbeat; it adds no model calls or database migration.

For each run the coordinator:

1. Clones Plunge into its own checkout and continues that idea's open branch, or
   creates `codex/idea-<opaque id>` from current `main`. A follow-up after a closed
   or merged PR gets a new branch based on main.
2. Runs `codex exec` with a workspace-write sandbox, network disabled, structured
   output and no inherited user config. Family discussion is quoted as data.
3. Accepts changes only under `src/ui`, `src/room`, `src/engine`, and `tests`.
   The private coordinator can additionally approve `worker/rooms.ts` and
   `worker/room-undo.ts` for one specific idea. Infrastructure, dependencies,
   account access, the builder and its credentials cannot be published by this
   path. Requests outside the approved scope become **Needs attention** with an
   explanation that private configuration is needed, not a permission question
   the family is repeatedly asked to answer.
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
text; they are not repository files. Unload the local LaunchAgent to stop new builds.
Do not delete an active run directory.

## Hand-built lane

Some changes are made by hand (by Jason, or a session working with him) rather than
by the automatic builder: anything outside its scope, like accounts. They still go
to the family through the same board and the same in-app preview:

```sh
node scripts/ideas/admin.mjs adopt 42 --title "Let Benny log in" --body "What it does, in family words."
node scripts/ideas/admin.mjs adopt 42 IDEA_ID   # link it to an existing card instead
```

`adopt` reads the open PR's head commit with `gh`, then calls `POST
/api/ideas/admin/adopt` with the builder key. A new card speaks as the owner; an
existing card keeps its author and conversation (a card the builder is working on
is refused). Either way the card moves to the `hand` lane in **Checking your
preview** with a short note, and prints its link. From there it is tracked like any
builder card: the same `version.json` check marks it **Ready to try**, a push
refreshes it, merging makes it **In the game**. A hand-built PR whose checks fail
stays watched, so the next push brings it back to checking.

The automatic builder never claims a hand-lane card, and the owner's access
approval and `retry` don't apply to one. A family reply stays conversation for
Jason (the card says so) instead of queueing a build. `ideas.lane` and the reply
trigger change are migration `0008_idea_hand_lane.sql`.

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

Use the repository skill `plunge-family-worker` for ongoing operation and recovery.
The helper `python3 scripts/ideas/service.py status|start|stop|install` manages the
local job. Install it from the stable checkout, then start it; future logins load
it automatically. `start` preserves an active build, while `stop` can interrupt it.

The installed macOS job is `~/Library/LaunchAgents/dev.plunge.family-ideas.plist`.
It invokes `node /Users/jason/code/plunge/scripts/ideas/builder.mjs` every 15 seconds.
Launchd does not overlap instances of the same job, and the coordinator also keeps
a process lock. Within that coordinator, up to three different ideas build at once.
It keeps polling every 15 seconds while builds are active and fills a free slot
as soon as a build finishes. Replies to one idea remain serial. The private
`maxConcurrent` setting accepts 1–4 (default 3); it never comes from family text.
The service excludes locally active ideas from claims, including expired leases,
so a slow build cannot accidentally start another turn of its own session. The previous Codex heartbeat is paused. Idle checks and preview
checks use ordinary code; only a claimed family request starts Codex. Results
appear on the idea card; this local scheduler does not send chat notifications
or attach PRs to a Codex chat. Logs are in `~/.local/share/plunge-ideas/listener.log`
and `listener-errors.log`. The LaunchAgent is local configuration, not shipped
with the website.

### Owner authorization and family approvals

The server records the signed-in account on each family message. The most recent
request in a claimed conversation receives repository-wide file access when its
author is still an owner with family access. Names, client-supplied account IDs,
invitation tokens, and claims made in message text never grant owner authority.
Existing account-backed messages are migrated using their non-invitation member
identity; invitation posts remain unprivileged even if named Jason.

On another family member's card, the signed-in owner sees **Approve full access**.
The button records the owner account and exact conversation revision, then requeues
a waiting/stopped request without adding a pretend family message. A racing new
reply or active build rejects the approval. A later family reply requires new
approval. A new owner-authenticated request authorizes its own turn automatically.
Approval needs a valid owner session cookie and same-origin request; the private
builder token is never sent to the browser.

The claim response contains a separate server-generated `authorization` record.
The coordinator archives it in `scope.json`, applies it to both the current prompt
and the changed-file check, and sends it on heartbeats and successful completion.
Owner role/family revocation invalidates that authorization before publication.
Historical messages and resumed Codex sessions cannot override the current grant.

Repository-wide access includes `worker/`, `migrations/`, configuration, and project
instructions. It applies only to the isolated checkout: Git internals, secret files,
credentials, and files outside it remain excluded. The live coordinator runs from
main, never from model-edited builder code. All builds still produce reviewed PRs;
this does not grant automatic merge or access to live accounts/services.

### Apply an approved room scope

For limited non-owner requests, private per-idea room-file exceptions remain
available. Card prose alone cannot edit this policy. When Jason approves the additional room files, record that approval in
the private coordinator configuration for the exact idea, then retry it:

```sh
node scripts/ideas/admin.mjs scope IDEA_ID worker/rooms.ts worker/room-undo.ts
node scripts/ideas/admin.mjs retry IDEA_ID
```

The `scope` command replaces that idea's additional-file list. Other ideas retain
the base game/UI scope. Only those two room files can be granted by this helper;
worker entrypoints, account handlers, infrastructure and credentials stay excluded.
Each run archives its approved files in `scope.json`, and the publication check
enforces the same list used in the prompt. `retry` uses the private admin endpoint
to queue a stopped card without inventing a family reply or changing conversation
history. It refuses to interrupt an active build or restart a ready preview.

Optional `PLUNGE_IDEAS_CONFIG` selects a private config file for local tests.
A config's `origin` must be production or localhost. `stateDir` selects a private
run archive. `onlyIdea` can restrict a diagnostic invocation to one card id.
These settings never come from family text.

### One Codex session per idea

`~/.local/share/plunge-ideas/ideas/<idea-id>/session.json` maps a card to its durable
Codex session. The coordinator records `thread.started` immediately, including
failed/interrupted attempts, and resumes that exact ID on later replies. It never
uses `--last`. Existing cards adopt the newest recorded session from their run
archives. Missing/corrupt saved session identities fail visibly rather than silently
routing a reply to another conversation.

Each turn still receives its own isolated checkout of the idea's current PR branch
(or main before publication), and its complete card conversation. Explicit `--cd`
and the same Astra High, workspace-write, no-network and no-approval settings apply
to resumed turns. Earlier checkouts remain archived; unpublished failed edits are
not automatically copied forward. Published changes continue on the same PR.
A per-run `session.json` records the actual returned session ID and whether it was
resumed. This mapping survives scheduler restarts and Mac logins. The session can
wait without a Codex process or LLM usage until another family message arrives.

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

## Conversation feedback

The coordinator posts a receipt as soon as it picks up a card. It forwards only
short completed public `agent_message` items from the existing Codex JSON stream,
never reasoning, command output, or the structured final result. The builder is
prompted to say what it understands before using tools, and to ask a short product
question when needed. Tests and publishing have explicit progress messages.
Updates are bounded, ordered, and idempotent under response retries; only the
current authorized run can append them. They do not increment the family request
revision. Follow-up messages remain queued for the next turn, and polling preserves
the unsent draft. Family members can ask to talk an idea through before changes.

A stopped build reports which stage failed without exposing raw logs. In
particular, Vitest reporting timeouts are described as a technical test-runner
problem, not a request to reword the idea. Full diagnostics remain in the private
run archive. The long AI strength tests yield between deterministic games so
reporting acknowledgments are serviced even under background CPU scheduling;
seeds, counts, pass thresholds, and all required checks remain unchanged.

### Screenshots in the conversation

The main app's idea and reply boxes accept up to two PNG, JPEG, or WebP pictures.
**Add a screenshot** opens the device's picture picker; **Mark where you mean**
provides an optional red pen with Undo. Existing phone markup works too. Tap a
sent picture to enlarge it without leaving the app. Pictures are visible to the
same signed-in family/invite members who can read the card. Playing remains guest
accessible; pictures are never public preview assets.

The browser resizes to at most 1600 pixels per edge, paints a fresh JPEG (removing
source metadata), and limits each picture to 400 KB. Text and pictures stay in an
IndexedDB draft across reloads; a storage failure explicitly asks the user to keep
the page open. Failed sends retain the draft. Two normalized pictures and text are
saved atomically in the immutable message's `screenshots` column (migration
0005), so retrying a message cannot append, replace, or duplicate its pictures.
Requests are bounded at 1.1 MB; other idea endpoints retain their 16 KB limit.

The protected image route requires current family access. The separate admin
image route is restricted to an active run's frozen conversation and lease.
Thread/claim JSON includes image metadata only. The trusted coordinator downloads
pictures to private `runs/<run>/screenshots/` files, outside its Git checkout,
and records the message/image/path mapping in `screenshots.json`. All pictures
in the frozen conversation are retained for follow-ups. The last eight are passed
with `--image` to both new and resumed Codex turns; the prompt allows read-only
viewing of earlier manifest images. Image content cannot grant permissions or
change coordinator instructions. Nothing uploads these files into a PR or preview. Claims advertise
`supportsScreenshots: true`; an older coordinator cannot claim an idea containing
pictures. This lets an already-running worker finish its current builds safely
before the LaunchAgent loads the updated coordinator.

Verification: `npm test`, `node --test scripts/test-ideas-builder.mjs`, and after
`npm run build`, `node scripts/test-accounts-browser.mjs`. The browser test uses
local D1, virtual passkeys, and intercepted requests, including markup, image-only
cards, reload/retry recovery, protected viewing, and 320/390-pixel layouts. It does
not replace testing a real iPhone's or Pixel's photo picker.
