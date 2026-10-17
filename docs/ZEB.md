# Zeb in Plunge

More → Computer player selects **Walt** or **Zeb** for solo play. Existing Walt
saves continue, including the older L1 selection. A change of player invalidates
in-flight decisions without discarding the game. Family rooms continue using Walt;
the room's canonical player policy is not a browser-local preference.

Zeb uses the pinned `@jasonyandell/zeb@0.4.1` package in a cancellable Web Worker.
New Zeb hands use ordinary engine shuffles instead of the frozen catalogue.
The worker receives only the actor's original hand and chronological public plays.
Receipts retain the package version, field-net hash, seed, world count, move scores,
and app build; they use the existing history storage and export paths.

Bidding uses fresh nine-declaration forecasts at 160 worlds with the documented
conservative 0.85 cutoff. The hand-only policy bids 30–42, respects a standing
partner bid, and obeys the engine's forced minimum. Match-aware mark escalation
and the optional overcall policy are not enabled. Trump selection maximizes the
forecast at the actual contract target. This is sampled prediction, not a guarantee
or the completed-game evidence used by Walt's catalogue.

The same forecasting path provides on-demand human bid/trump hints. Ordinary
moves use 160 worlds; Think deeper uses 512. Computation runs outside the UI thread,
can be cancelled on navigation or player changes, and reports errors with retry
instead of silently substituting another player. The package does not support
Nel-O; those contracts explicitly retain Walt's existing implementation. Move
review shows Zeb’s saved weighted estimates without inventing raw success counts.
A fresh recheck remains explicitly labeled Walt analysis.

Vite bundles Zeb's WASM URL explicitly. The existing service worker caches both
players from first launch, including the worker code and WASM. Validation:

```sh
npm run typecheck
npm test
npm run build
npm run test:offline:browser
npm run test:zeb:browser
```

The Zeb browser check selects the player through Settings, reloads offline,
requests a real bidding hint, plays a full hand, checks saved Zeb receipts, and
verifies the service-worker update. These are automated Chromium checks, not a
physical-device performance claim.
