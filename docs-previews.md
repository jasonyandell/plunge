# Pull request previews

Every same-repository PR, including drafts, receives its own deployed app after
the importer tests, deployment tests, application tests, typecheck and build pass.
Open **View deployment** on the PR or **Open the preview** in its **PR preview**
Actions run. The URL stays the same across pushes:
`https://plunge-pr-<number>.<account-subdomain>.workers.dev`.
It works from a phone without a development machine running.

Each PR owns one Worker (`plunge-pr-N`) and **no question database**. Previews are built
with `PLUNGE_QUESTIONS=local-only`. In that mode, **Why this move?** and **Why this hint?**
save to that phone's browser storage only. Your questions says nothing is sent,
and short links are hidden. The preview Worker answers every `/api/questions`
request with `503 {"local_only": true}`. No question is uploaded, and none can
reach production. Game history and **Talk over past hands** were always
device-only and work unchanged. Each preview has its own origin, so browser
storage stays separate from production. **Closing or merging the PR deletes its Worker**,
along with any `plunge-pr-N-questions` database left by an earlier preview.

Production still deploys only from `main`, with its question database and the
default `PLUNGE_QUESTIONS=remote` build. Even a manual production workflow run on
another branch skips deployment. PR previews use a generated, separate Wrangler
configuration with no production bindings or routes. Worker/asset settings in
`scripts/preview.mjs` must be kept aligned with `wrangler.toml` when those change.

To try a local-only build yourself: `npm run build:local-only`
(`PLUNGE_QUESTIONS=local-only npm run build`). Any value other than `remote` or
`local-only` fails the build.

## Operations

- Existing `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` repository secrets
  are reused. Deploying needs only Workers Scripts access. D1 edit is still used by
  production and by cleanup of legacy preview databases. Credentials are supplied
  only to configuration, deployment and cleanup steps.
- Fork PRs run ordinary CI without cloud deployment. Previews are for trusted
  branches in this repository; branch code and workflows can use repository secrets.
- Deployment tools come from the PR's own head when its `scripts/preview.mjs`
  declares `PREVIEW_PROTOCOL = 'local-only-v1'` or `family-rooms-v1`. Otherwise they come from the
  commit that defines the running workflow. This holds for runs dispatched from
  `main` too, so a PR is deployed by its own updated tools. Either way, the
  workflow's own copy then checks the complete generated configuration
  (`preview.mjs check-config`) against that selected protocol: one PR-named Worker,
  its exact assets settings, no question storage and no routes. The room protocol
  alone permits the `ROOMS` binding to its own `PlungeRoom` class and the one
  `new_sqlite_classes` migration; bindings to another Worker are rejected.
  The workflow itself never runs D1 commands. A commit that predates local-only
  mode fails at the stamp step rather than deploying an app that would offer
  uploads. Rebase it to get a preview.
- Deploy and cleanup share a per-PR concurrency group and do not interrupt active
  resource mutations. Each run resolves the current PR state and verifies its
  head again after tests, so superseded builds do not overwrite newer previews.
- Smoke checks verify the exact commit, an app built for local-only questions,
  and a question service that refuses storage, before publishing the GitHub
  deployment link.
- Rerun a failed job, or choose **Actions → PR preview → Run workflow**, keep
  branch `main`, and enter a PR number. Open PRs deploy their current head; closed
  PRs clean up. This also bootstraps existing PRs that predate this workflow.
- Cleanup is repeatable. It deletes serving code before any legacy database; failures
  remain visible as failed workflow runs. GitHub deployment records are retained
  as history and marked inactive after successful cleanup.
- Previews are public and send `noindex` headers. They use normal Cloudflare and
  GitHub Actions quotas; the workflow does not change the account plan.

Local deployment-tool checks: `node --test scripts/test-preview.mjs`.

## Experimental family rooms

The `family-rooms-v1` preview protocol builds with `PLUNGE_ROOMS=experimental`.
Production builds with rooms enabled too. Its `ROOMS` binding names its own
`PlungeRoom` class and SQLite namespace; the existing `QUESTIONS` database is
unchanged. Ordinary `local-only-v1` previews still build with rooms off.

A room needs no account. Its link contains a random 128-bit room identifier;
each occupied seat receives a separate random 256-bit browser key. Keep the link
within the group. This prototype shares all four hands with trusted room members.
It provides no competitive privacy or host migration.

Each Worker uses its own SQLite-backed Durable Object class to persist each room's
game, seats, action revision, and bounded retry identifiers. The engine owns the
legal turns. Clients cannot accidentally act for another person, apply a stale
move, or apply a successful retry twice. The host browser runs the existing Walt
player for empty seats. New people can join the lobby or between hands. No person
is replaced automatically, and Undo/restart is unavailable in a shared game.

The host must keep the room open. All play pauses while any occupied seat is
disconnected. A five-second browser heartbeat lets the coordinator detect a
silently suspended phone after fifteen seconds. Refreshing or reopening the room
from the same browser restores that seat and exact saved game. The room expires
after approximately 24 hours without activity. Closing the PR requests deletion
of its Worker and its private room namespace along with any legacy preview
question database. The [Worker deletion API](https://developers.cloudflare.com/api/typescript/resources/workers/subresources/scripts/methods/delete/)
removes the namespaces implemented by that Worker. Cleanup uses no `force` flag:
if another Worker references the preview, deletion must fail visibly instead of
breaking that other Worker. It never targets a production Worker or namespace.

SQLite Durable Objects and hibernating WebSockets work on the existing Workers
Free plan; no plan change is required. The free limits include 100,000 daily
requests, 13,000 GB-seconds of compute, and 5 GB of room storage. Quota exhaustion
fails requests instead of upgrading the account. See [Cloudflare's pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Local coordinator checks: `npx vitest run tests/rooms.test.ts tests/rooms-api.test.ts`.
The integration checks use a local Miniflare SQLite runtime, two WebSocket
clients, action retries, disconnect/rejoin, a silent host timeout, and a complete
runtime restart. To serve the coordinator locally, generate the preview config,
build its assets, and run `wrangler dev --config wrangler.preview.generated.json`.

For the phone UI, run `PLUNGE_ROOMS=experimental PLUNGE_QUESTIONS=local-only npm run dev`.
Vite proxies room HTTP and WebSockets to port 8788; start Wrangler on that port.
Choose **Play with family** in the usual Plunge home, create a room, and copy its
invite or room code. Another person can open their existing Plunge app, choose
**Play with family**, and paste the room code or same-origin invite. This keeps
joining inside that app; it does not depend on the OS opening links in an installed
PWA. The application's manifest and origin are unchanged. Starting a family room
never overwrites the solo resume save.
`PLUNGE_ROOM_URL=http://127.0.0.1:5173 npm run test:rooms:browser` uses two independent
Chromium phone contexts and the real host Walt worker. It checks a complete hand,
refresh/rejoin, rejected stale/wrong-seat moves, duplicate acknowledgement, host
disconnect/rejoin, and phone layout. It also accepts a deployed preview origin.
Install the browser once with `npx playwright install chromium` if needed.

Shared-room recorder snapshots retain canonical seats, human names, revision,
auction evidence and Walt receipt links under `room.mode = shared-room`. They
stay separate from solo finished-hand stats. Export on the host device to include
the original Walt receipt bodies; guest devices retain the shared receipt links.
Room access and seat keys are omitted from exported recorder provenance.

A room-enabled manual preview must run the workflow from this feature branch
until its protocol checker lands on `main`. Main's older workflow understands
only the database-free `local-only-v1` protocol and cannot enable room bindings.

## Activation checks (2026-09-21)

PR #5 exercised the initial deployment from a feature branch. Run
`35558307501` published its HTTPS deployment link after all checks passed.
A question written to its notebook was read back successfully and returned 404
at the production origin. A manual production run from the feature branch
(`35558353493`) skipped its deploy job as intended. The local application suite
passed all 227 tests; the seven deployment tests, importer tests, build,
Actionlint, and Wrangler dry run also passed.
