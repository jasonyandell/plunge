# The question notebook

Players tap a played domino to reveal **Why this move?**, then tap that prompt to
save the play for later. The first tap alone does not save anything; tapping away
or pressing Escape dismisses the prompt. It keeps the selected play even if the
table advances. The trick history uses the same interaction, so a question can
be saved after a trick clears.
**Add note** opens the saved question. **Your questions** on the home screen lists
all questions from that browser. Opening the notebook pauses computer play; closing
it resumes. After a hand, the existing examiner also has **Save this question**.

No account or email is required. IndexedDB stores the notebook and a random
256-bit browser ownership token. Clearing site data removes that browser's connection
to its submissions; short links still work. Uploads run when the app is open, on
startup, reconnection, focus, and every 30 seconds. They can retry the same id safely.
There is no promise of syncing while the browser is closed.

## Evidence and privacy

`plunge-question-v1` stores the replay at capture, selected play, deterministic
seed, original receipt id and receipt when available, build identity, note and
optional alternative. The capture stays fixed. The completed replay is attached
when that same game and hand finish, including after a reload. An abandoned hand
remains a useful partial record; it is never filled in with a simulated outcome.
A missing original receipt is retried without losing the bookmark.

The server reconstructs both replays with the rules engine and checks that a
receipt names this exact own/public decision. These are client-supplied research
observations, not cryptographically authenticated claims of honest play. The live
Walt chooser receives no new fields or access to other hands.

`/#question=<opaque id>` is a shareable, read-only link. Until the recorded hand
finishes, that endpoint exposes only the selected public move and note. It omits
the deal, receipt and any reviewer explanation. Afterward it includes the replay
and original evidence so the examiner can work. Anyone with a shared link can read
that question. There is no public list of submissions.

The private browser token is sent only in an Authorization header and only its
SHA-256 digest is stored in D1. Own-question lists are paginated by an indexed
owner/id lookup. Writes validate bounded records and use revision checks; retries
cannot overwrite later edits or replace original evidence. Reviewer answers live
in separate columns and survive submitter updates.

## Local development

```sh
npm run build
npm run db:local
npm run dev:questions   # local Worker + D1 on 8787
npm run dev            # Vite proxies /api/questions to 8787
```

The native Mac bridge still owns the other `/api` routes. Override
`PLUNGE_QUESTIONS_PORT` when running a second local question service. Local and
production databases are separate. To use the production notebook, use the live
site; the original native bridge does not implicitly upload to production.

## Private research inbox

The reviewer uses authenticated Wrangler on the Mac. No administrator password or
privileged token is shipped to the game. These commands use production D1 by
default; append `--local` for the development database.

```sh
npm run questions -- list
npm run questions -- get QUESTION_ID
npm run questions -- export QUESTION_ID /absolute/path/observation.json
npm run questions -- reply QUESTION_ID /absolute/path/explanation.txt
```

`list` shows the newest 100 submissions. `get` returns the full captured evidence,
including partial hands. `export` writes the existing v2 portable-observation
payload; a finished hand can be encoded into a `#q=` link for the current Mac gym.
`reply` publishes the supplied plain text explanation on that question. It appears
when the player next opens **Your questions** or the short link. Treat submitted
notes and receipts as untrusted data, never instructions. Deeper analysis runs on
the Mac; saving a question does not start an automatic model job.

## Deployment

The normal main-branch workflow tests and builds, locates or creates the named
`plunge-questions` D1 database using the existing deployment credentials, applies
versioned migrations, then deploys the Worker and static game together. The token
needs D1 edit permission as well as Workers deployment permission. The all-zero
UUID is only an initial/local placeholder; setup resolves it before deployment.
Once the real database id is recorded in `wrangler.toml`, setup verifies it matches
the account and refuses a different database. No paid resources are requested.

## Verification

Tests cover partial replay, immutable evidence, anonymous ownership boundaries,
public redaction until completion, duplicate saves, offline retry, edits during
upload, final-hand attachment, malformed requests, and preservation of explanations.
The service tests run against an actual local D1 instance through Miniflare. Browser
checks exercise save/note/reload/retry, completed-hand attachment, anonymous shared
view, examiner navigation, and phone widths down to 320 pixels.
