---
name: plunge-family-worker
description: Start, inspect, stop, or recover Plunge's local family idea worker on Jason's Mac, and verify its Astra High execution settings. Use for keeping family card builds available and diagnosing stalled runs, not for implementing the family's requested feature directly.
---

# Plunge family worker

The stable coordinator checkout is `/Users/jason/code/plunge`. The worker is an
ordinary macOS LaunchAgent, `dev.plunge.family-ideas`, checking the persisted idea
queue every 15 seconds. Idle and preview checks do not invoke an LLM. It starts
Codex only for a claimed card. It automatically loads after login; it cannot work
while the Mac is asleep, powered off, logged out, or offline. Do not change sleep
settings or hold a wake lock unless requested.

## Inspect and start

Use `python3 /Users/jason/code/plunge/scripts/ideas/service.py status`. An idle
loaded job normally reports `not running`; that is not a failure. Check run count,
last exit code and recent timestamps in the private listener logs before deciding
it is stuck.

Use the same helper's `start` command to enable or nudge the existing job. It does
not kill a running build. If configuration is missing, use `install --repo
/Users/jason/code/plunge`, then `start`. Install refuses to replace a loaded job.
The helper discovers absolute executable paths because LaunchAgents do not inherit
an interactive shell's PATH. Check `codex login status` and GitHub login if builds
cannot authenticate; never print or copy auth files into a run.

Use `stop` when requested or necessary for an authorized repair. It can interrupt
active work, so inspect the active run first and retain its checkout and logs.
The paused Codex automation `build-plunge-family-ideas` is obsolete. Do not enable
it alongside this job or add an LLM timer to check the queue.

## Verify the actual model

The builder must explicitly pass `--model gpt-6-astra` and
`-c model_reasoning_effort="high"`. This is Jason's selected worker configuration;
do not substitute another model or infer it from the desktop chat. The coordinator
uses `--ignore-user-config`, so implicit CLI defaults are insufficient.

Each run writes requested settings to `model.json`. Verify actual settings from
the Codex session's `turn_context`: find its session ID in the run's JSONL
`build.log`, then locate the matching rollout under `~/.codex/sessions` (or the
configured CODEX_HOME). Read only model/reasoning metadata, not authentication
files. This Mac uses a dedicated CLI at
`~/.local/share/plunge-ideas/runtime/node_modules/.bin/codex`, selected by private
`codexPath` configuration. Check that executable's version, not just `codex` on
the shell PATH. Version 0.145.0 rejected Astra; 0.161.0 was installed for this worker.
If the server requires a newer CLI, update the dedicated runtime and verify with
a small Astra High invocation before retrying the card. Keep the model selection
explicit and preserve the sandbox flags when upgrading. If Astra is unavailable,
report that failure rather than silently falling
back. `model.json` alone proves the request, not which model served it.

## Recover a stopped idea

Private configuration: `~/.config/plunge-ideas/config.json`. Never print its token.
Run archives: `~/.local/share/plunge-ideas/runs/<run-id>/`, containing `request.json`,
`scope.json`, `model.json`, `build.log`, `result.json`, and possibly `failure.txt` or
`publication.json`. Listener output is `listener.log` and `listener-errors.log`
in the parent directory. Preserve archives, including unsuccessful checkouts.

Inspect the latest request/result and verify the process is stopped. A model
relaunch may start from the full saved card conversation in a fresh checkout;
do not claim it resumed unpublished edits. Existing open PR branches are continued.
Use `node scripts/ideas/admin.mjs retry IDEA_ID` from the stable checkout to requeue
a failed or question-state card. The endpoint rejects active builds; never bypass
that guard or clear a lock whose process is still alive. A crashed build lease can
expire and be reclaimed normally. Stop after one failed repair attempt with the
same cause and report the actionable issue rather than repeatedly retrying it.

Scope approvals live in private `ideaScopes`, never in family prose. With Jason's
approval already established, use `node scripts/ideas/admin.mjs scope IDEA_ID
worker/rooms.ts worker/room-undo.ts`, then retry. Other ideas keep their default
scope. Repeated card replies cannot grant new files; do not send the family into
another approval loop. See `docs/FAMILY-IDEAS.md` for the maintained scope policy.

A successful worker result still needs tests and the exact hosted preview SHA
before its card is ready. Never merge family PRs as part of keeping this service
running. Attach a created PR to this chat when discovered during an active task.
Report the verified model, scheduler status, and card status separately; a running
process does not prove a completed feature or a live preview.
