# Plunge

A free, open source, mobile web **Texas 42** game — you and Gran against Earl and Ruby,
best of luck to the both of you.

**Play it: https://plunge.jasonyandell.workers.dev** — works in any phone browser,
installable as an app, plays offline.

42 is the Official State Domino Game of Texas: a trick-taking game played with a
double-six set, invented in 1887 in Garner, Texas by William Thomas and Walter Earl as a
domino stand-in for card games. This implementation plays the **casual family game** by
default — Nel-O, Plunge, and Splash all on the table (it's named Plunge for a reason) —
with a tournament-legal "straight 42" preset and every documented rules variant
configurable.

## What's inside

- **Rules engine** (`src/engine/`) — a pure, deterministic state machine. The trick
  mechanics are a direct translation of the suit algebra in
  [`docs/SUIT_ALGEBRA_PURE.md`](docs/SUIT_ALGEBRA_PURE.md); the full consolidated rules
  live in [`docs/RULES.md`](docs/RULES.md). Reneges are impossible by construction.
  Every invariant in RULES.md §10 is property-tested with fast-check, and the suite has
  been mutation-tested (11/11 injected engine bugs caught). Same seed, same game —
  every hand is replayable.
- **AI opponents** (`src/ai/`) — three honest difficulties. Easy plays like a kid
  learning the game; medium is a solid club player on pure heuristics (pulls trump,
  protects count, feeds partner's winners, knows when to Plunge); hard refines medium
  with Monte Carlo determinization over information sets — it samples worlds consistent
  with what it has seen, including voids proven by failures to follow. No peeking: the
  AI only ever sees what a human in its chair would (`src/ai/observation.ts` makes
  cheating structurally impossible). The strength ladder is enforced in CI by playing
  full head-to-head matches: medium beats easy, hard beats medium, every push.
- **UI** (`src/ui/`) — mobile-first Preact app, ~20 kB gzipped. Marks are tallied the
  traditional way, by drawing the word **ALL** stroke by stroke. An info bar keeps the
  current trump and led suit visible, with a collapsible trick history for when you
  need to know whether the 5-5 already walked. Games auto-save and resume.

## How it ships

Every push to `main` runs the full suite (engine invariants, AI legality + strength
ladder, store tests) and only then deploys to Cloudflare Workers via GitHub Actions.
Deploys stamp `version.json` with the commit SHA; open tabs notice within a few minutes
and offer a one-tap reload ("a fresh version's been dealt") — in-progress games survive
via auto-save.

The direction of travel is [family vibe coding](https://github.com/jasonyandell/plunge/issues/1):
an in-game suggestion box that files GitHub issues, and an agent loop that implements
them — with the test gauntlet deciding what ships. Somebody says it at the table, and it
becomes part of the game.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # engine invariants, AI legality/strength, store tests
npm run build      # typecheck + production build
```

The AI contract is one function — `chooseAction(state, seat, difficulty, rand)` — so the
players are easy to lift into other harnesses (`src/ai/harness.ts` is a deterministic
auction-plus-play arena to 7 marks, used by the strength tests).

## Rules configuration

The §9 configuration matrix in [`docs/RULES.md`](docs/RULES.md) is implemented as
`GameConfig` (`src/engine/types.ts`): all-pass handling, Nel-O availability and doubles
treatment, Plunge/Splash values, Sevens, follow-me doubles, forced-bid options. Two
presets ship in the UI: **Casual** (default) and **Tournament** (N42PA straight 42).

## License

Public domain under [CC0 1.0](LICENSE). Steal anything. Built for the love of the game.
