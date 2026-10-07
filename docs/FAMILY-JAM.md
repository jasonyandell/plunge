# Family jam

The family vibe-coding loop from issue #1: someone types an idea inside Plunge, a
builder turns it into a pull request, the PR preview deploys it, and they talk to
the builder from the same screen. GitHub is the only store. Nobody in the family
needs a GitHub account, an app, or a login.

```
phone → Worker /api/jam → GitHub issue (label: jam) → builder → PR "Jam #N: …"
                                     ↑                                  ↓
                        replies as issue/PR comments      preview.yml → plunge-pr-N.texas42.workers.dev
```

## What the family sees

**Family jam** on the home screen opens the board. The first visit asks for the
family passphrase (or arrives through an invite link that carries it) and a first
name. Then: a box to type an idea, and a list of every idea with a status pill:

| Status | Meaning |
| - | - |
| In the queue | Issue filed; no pull request yet |
| Being built | A pull request is open; the preview isn't live yet |
| Ready to try | The PR preview answers for that PR number; a **Try it** button opens it |
| Shipped! | The pull request merged |
| Set aside | The issue was closed without a merge |

Tapping an idea shows the original text, the builder's replies and a reply box.
Replies go to the open pull request when there is one (that is the branch the
builder pushes to), otherwise to the issue. The app strips the hidden `@codex`
instruction block and shows only the human parts.

One line of honesty is shown in the app: ideas and replies are posted publicly on
GitHub under the first name given, and the game is CC0, so whatever gets built is
public domain like the rest of Plunge.

## Two builders, one switch

Both builders read `AGENTS.md` and produce the same shapes (branch `jam/N`, PR
`Jam #N: …` with `Closes #N`), so the Worker and the app don't care which is on.

| | `JAM_BACKEND=codex` (default) | `JAM_BACKEND=action` |
| - | - | - |
| Runs on | Codex cloud, via the GitHub integration on Jason's ChatGPT plan | GitHub Actions, `openai/codex-action@v1` |
| Billing | Jason's existing subscription | OpenAI API key, pay per use, capped in the OpenAI dashboard |
| Trigger | The Worker posts an `@codex …` comment as the repo owner | `.github/workflows/jam.yml` on `jam` label / family reply |
| Opens the PR | Codex cloud (confirm in the Codex task if it only offers a diff) | The workflow, deterministically, then dispatches the preview |
| Fine print | OpenAI's docs point unattended automation at API keys; the GitHub integration is OpenAI's own subscription surface, used on Jason's own repo, from Jason's own account | Unambiguous |

The switch lives in two places that must agree: the GitHub repository variable
`JAM_BACKEND` (gates the workflow) and `JAM_BACKEND` under `[vars]` in
`wrangler.toml` (tells the Worker whether to post `@codex` mentions).

## Setup (once)

1. **GitHub token for the Worker.** Create a fine-grained personal access token
   scoped to `jasonyandell/plunge` with *Issues: read & write*, *Pull requests:
   read & write*, *Metadata: read*. Then:
   ```sh
   npx wrangler secret put JAM_GITHUB_TOKEN
   ```
2. **Family passphrase.** Anything the family can say out loud. Matching ignores
   case and spacing.
   ```sh
   npx wrangler secret put JAM_PASSPHRASE
   ```
   Invite link: `https://plunge.texas42.workers.dev/?jam=1#jam=<passphrase>` — the
   app shows a **Copy invite** button once you're in.
3. **Codex backend (default).** Make sure the repo is connected in Codex cloud
   (it already is: the `codex/*` branches came from there) and that a cloud
   environment exists for it. That's it; `@codex` comments posted as you start
   tasks on your plan.
4. **Action backend (optional fallback).** Add an OpenAI API key with a monthly
   budget cap in the OpenAI dashboard, then:
   ```sh
   gh secret set OPENAI_API_KEY
   gh variable set JAM_BACKEND --body action
   ```
   and set `JAM_BACKEND = "action"` in `wrangler.toml`.

The `jam` label exists on the repo. Previews have none of these secrets, so the
jam board on a preview says to use the main site.

## Guardrails

- Passphrase required for every call; wrong origin rejected on writes.
- Family text is cleaned: control characters removed, `@mentions` and `<!--`
  neutralized so nobody but the Worker can address the builder or spoof a marker.
- Caps: 20 ideas per rolling day across the family, 12 replies per idea per hour,
  16 KB request bodies. One builder run at a time (`concurrency: family-jam`).
- The builder may not touch rules, scoring, dealing, the AI ladder, workflows,
  Worker code or secrets (`AGENTS.md`), and the existing test gauntlet gates both
  previews and production.
- Every change traces to who asked for it: the issue body names the person and
  the device, and the PR says `Closes #N`.

## Local development

```sh
npm run dev:questions   # Worker on 8787; set JAM_* in .dev.vars for a real repo
npm run dev             # /api/jam is proxied like the other /api routes
```

A git-ignored `.dev.vars` file can hold `JAM_GITHUB_TOKEN`, `JAM_PASSPHRASE` and
`JAM_REPO=you/your-fork` to exercise the loop against a scratch repository. The
tests in `tests/jam-api.test.ts` run against an in-memory GitHub and need nothing.
