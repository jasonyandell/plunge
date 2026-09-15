# Plunge

A free, open source, mobile web **Texas 42** game — you and Gran against Earl and Ruby,
best of luck to the both of you.

**Play it: https://plunge.jasonyandell.workers.dev** — works in any phone browser,
installable as an app, plays offline.

The live table plays **straight 42** with regular bidding: 30–41, then marks.
Each player bids once or passes, starting left of the shaker; the winner calls
trump and leads. Four passes throw the hand in. First team to seven marks wins.

**Deal me in** starts the game with the saved computer player. **Advanced settings**
keeps the L1 and partner-check choices available. After a hand, **See how it went**
opens the move scores; **Think deeper** requests a larger comparison. Sample and
decision details expand separately, and **Save or share this move** holds notes,
portable links, and the native Mac gym tools. Original scores remain separate
from later estimates.

## What's inside

- **Walt** is one shared Rust player, native on the Mac and WebAssembly on the
  phone. It chooses plays from its own hand and public history with fixed L1
  40/8 and an optional bounded partner count-offer check. The bidder's opening
  lead asks deeper L1 for 160 worlds with 20 seconds, retaining a complete
  40-world comparison first; later play keeps 40 worlds and 14 seconds. The
  deeper opening does not reinterpret the 40/8-only partner check. No hidden
  hands cross the live decision boundary.
- **Bidding** compares all nine declarations at the cheapest legal raise. Each
  computer has 20 seconds for complete 4/12/40/160-world surveys. It bids when the
  best sampled make estimate is at least 75%, otherwise passes, and passes over
  partner. This is a simple initial policy over uncalibrated model estimates.
  The winning trump is remembered; it is not searched again after bidding.
  On the phone, two independent workers share the declaration queue (one when
  the browser reports only one processor). Each runs the same Rust player.
  Only complete surveys are ranked, with the same samples and seeded ties.
  The entire pool stops on cancellation; a crashed job can retry once inside
  the original time budget. Ordinary play still uses one worker.
- **The table** saves games and original move scores on the device. After a hand,
  inspect a move, ask Walt to think deeper with 160 worlds, or copy a portable
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

With the development server running, `/scripts/auction-pool.html` compares one
through four real WASM workers on three fixed hands. It checks exact survey
agreement, wall deadlines, cancellation and subsequent play, and displays raw
JSON receipts. It reads no saved games. This development page is not part of
the production app; use it on the target device when tuning concurrency.

## License

Public domain under [CC0 1.0](LICENSE). Steal anything. Built for the love of the game.
