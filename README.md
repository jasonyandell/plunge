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
  Every invariant in RULES.md §10 is property-tested with fast-check.
- **AI opponents** (`src/ai/`) — three honest difficulties. Easy plays like a kid
  learning the game; medium is a solid club player on pure heuristics; hard refines
  medium with Monte Carlo determinization over information sets (no peeking — the AI
  only ever sees what a human in its chair would).
- **UI** (`src/ui/`) — mobile-first Preact app. Marks are tallied the traditional way,
  by drawing the word **ALL** stroke by stroke.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # engine invariants, AI legality/strength, store tests
npm run build      # typecheck + production build
```

## Rules configuration

The §9 configuration matrix in [`docs/RULES.md`](docs/RULES.md) is implemented as
`GameConfig` (`src/engine/types.ts`): all-pass handling, Nel-O availability and doubles
treatment, Plunge/Splash values, Sevens, follow-me doubles, forced-bid options. Two
presets ship in the UI: **Casual** (default) and **Tournament** (N42PA straight 42).

## License

Public domain under [CC0 1.0](LICENSE). Built for the love of the game.
