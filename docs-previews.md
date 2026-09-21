# Pull request previews

Every same-repository PR, including drafts, receives its own deployed app after
the importer tests, deployment tests, application tests, typecheck and build pass.
Open **View deployment** on the PR or **Open the preview** in its **PR preview**
Actions run. The URL stays the same across pushes:
`https://plunge-pr-<number>.<account-subdomain>.workers.dev`.
It works from a phone without a development machine running.

Each PR owns one Worker (`plunge-pr-N`) and one D1 database
(`plunge-pr-N-questions`). Its database persists across pushes; migrations apply
only there. Browser storage also stays separate because each preview has its own
origin. There is no copy of production questions. Preview questions and links
are temporary: **closing or merging the PR deletes its Worker and database**.
Export any evidence worth keeping before closing. Reopening starts afresh.

Production still deploys only from `main`. Even a manual production workflow run
on another branch skips deployment. PR previews use a generated, separate Wrangler
configuration with no production bindings or routes. Worker/asset settings in
`scripts/preview.mjs` must be kept aligned with `wrangler.toml` when those change.

## Operations

- Existing `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` repository secrets
  provide Workers Scripts edit and D1 edit access. Credentials are supplied only
  to resource preparation, migration, deployment and cleanup steps.
- Fork PRs run ordinary CI without cloud deployment. Previews are for trusted
  branches in this repository; branch code and workflows can use repository secrets.
- Deploy and cleanup share a per-PR concurrency group and do not interrupt active
  resource mutations. Each run resolves the current PR state and verifies its
  head again after tests, so superseded builds do not overwrite newer previews.
- Smoke checks verify the exact commit, app response, and a real authenticated D1
  notebook query before publishing the GitHub deployment link.
- Rerun a failed job, or choose **Actions → PR preview → Run workflow**, keep
  branch `main`, and enter a PR number. Open PRs deploy their current head; closed
  PRs clean up. This also bootstraps existing PRs that predate this workflow.
- Cleanup is repeatable. It deletes serving code before its database; failures
  remain visible as failed workflow runs. GitHub deployment records are retained
  as history and marked inactive after successful cleanup.
- Previews are public and send `noindex` headers. They use normal Cloudflare and
  GitHub Actions quotas; the workflow does not change the account plan.

Local deployment-tool checks: `node --test scripts/test-preview.mjs`.

## Activation checks (2026-09-21)

PR #5 exercised the initial deployment from a feature branch. Run
`35558307501` published its HTTPS deployment link after all checks passed.
A question written to its notebook was read back successfully and returned 404
at the production origin. A manual production run from the feature branch
(`35558353493`) skipped its deploy job as intended. The local application suite
passed all 227 tests; the seven deployment tests, importer tests, build,
Actionlint, and Wrangler dry run also passed.
