# Plunge — notes for coding agents

Plunge is a free, open source (CC0) mobile-web Texas 42 game. `docs/RULES.md` and
`docs/SUIT_ALGEBRA_PURE.md` are the rules authority; the engine in `src/engine` is
property-tested against them and nothing ships unless `npm run typecheck && npm test`
pass. `node_modules` is tracked in git: never commit churn under it. Previews deploy
per pull request from `.github/workflows/preview.yml`; production deploys from `main`.

## Family jam

Ideas typed inside the game arrive as GitHub issues labeled `jam` (see
`docs/FAMILY-JAM.md`). The people asking are family, not programmers. When you build
a jam idea:

- **Branch and PR.** Work on `jam/<issue number>`. Open one pull request titled
  `Jam #<issue number>: <short title>` with `Closes #<issue number>` in the body and
  the `jam` label. If a PR for the idea is already open, push to its branch instead.
- **Small and visible.** Make the smallest change that delivers what was asked, in
  the UI the family actually uses (`src/ui`, `src/room`). Do not change rules,
  scoring, dealing or the AI ladder for a jam idea; if the idea needs that, say so in
  plain words and stop.
- **Prove it.** Run `npm run typecheck && npm test`. Add or adjust a test when the
  change has logic worth protecting. Never weaken an existing test to get green.
- **Stay in your lane.** Do not touch `.github/`, `wrangler.toml`, `worker/`,
  secrets, analytics or network calls. No new dependencies.
- **Reply like a person.** End with two or three plain sentences for the family:
  what changed, where to find it, and anything you chose on their behalf. No file
  names, no jargon. The preview link appears in the app on its own.
