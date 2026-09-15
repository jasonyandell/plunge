# Plunge

A free, open source, mobile web **Texas 42** game — you and Gran against Earl and Ruby,
best of luck to the both of you.

**Play it: https://plunge.jasonyandell.workers.dev** — works in any phone browser,
installable as an app, plays offline.

The live table plays **straight 42** with regular bidding: 30–41, then marks.
Each player bids once or passes, starting left of the shaker; the winner calls
trump and leads. Four passes throw the hand in. First team to seven marks wins.

## What's inside

- **Walt** is one shared Rust player, native on the Mac and WebAssembly on the
  phone. It chooses plays from its own hand and public history with fixed L1
  40/8 and an optional bounded partner count-offer check. No hidden hands cross
  the live decision boundary.
- **Bidding** compares all nine declarations at the cheapest legal raise. Each
  computer has 4.5 seconds for complete 4/12/40-world surveys. It bids when the
  best sampled make estimate is at least 75%, otherwise passes, and passes over
  partner. This is a simple initial policy over uncalibrated model estimates.
  The winning trump is remembered; it is not searched again after bidding.
- **The table** saves games and original move scores on the device. After a hand,
  inspect a move, ask Walt to look closer with 160 worlds, or copy a portable
  observation link for the Mac gym. Leaving a position cancels its worker.
- **The rules engine** is an independent pure state machine, with legal actions,
  replayable hands, points/marks scoring, and property tests. Historical variants
  and AI implementations remain in the repository as references; the active UI
  uses straight 42 and the shared Walt player.

## How it ships

Every push to `main` runs the full suite (engine invariants, AI legality + strength
ladder, store tests) and only then deploys to Cloudflare Workers via GitHub Actions.
Deploys stamp `version.json` with the commit SHA; open tabs notice within a few minutes
and offer a one-tap reload ("a fresh version's been dealt") — in-progress games survive
via auto-save.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # engine invariants, AI legality/strength, store tests
npm run build      # typecheck + production build
```

To import a new shared player after committing its source:

```sh
python3 scripts/update-walt.py /path/to/texas-42
```

Commit the resulting wasm and manifest together. Builds verify the asset hash
and host imports. The source repository's `walt/walt-player/README.md` documents
budgets, protocol, tests and the native table launcher. The Mac's original-score
and recheck paths support every straight contract; its older full counterfactual
gym comparison is currently scoped to bid 30.

## License

Public domain under [CC0 1.0](LICENSE). Steal anything. Built for the love of the game.
