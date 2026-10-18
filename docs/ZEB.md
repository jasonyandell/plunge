# Zeb in Plunge

`/?settings=player` opens the player controls directly without changing a saved game.
More → Computer player selects **Walt** or **Zeb** for solo play; the home screen and table identify the selection. Existing Walt
saves continue, including the older L1 selection. A change of player invalidates
in-flight decisions without discarding the game. Family tables choose the player by vote in the lobby or Table dialog. That choice
and its version belong to the room, and follow every runner and reconnect. A
client with a different package version must refresh before running the table.

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

The same forecasting path provides on-demand human bid/trump hints in solo and
family games. Bid, trump and move hints can be saved to the question notebook
with their original model identity and evidence. Ordinary
moves use 160 worlds; Think deeper uses 512. Computation runs outside the UI thread,
can be cancelled on navigation or player changes, and reports errors with retry
instead of silently substituting another player. The package does not support
Nel-O; those contracts explicitly retain Walt's existing implementation. Move
review shows Zeb’s saved weighted estimates without inventing raw success counts.
A fresh recheck remains explicitly labeled Walt analysis.

Auction advice leads with one recommendation and a reason tied to the actual
auction: the forecast cutoff, support for a partner, a forced bid, or the
one-mark policy limit. **Compare trumps** ranks all nine declarations for an
explorable 30–42 point target and labels ties. Changing that target neither
changes the recommendation nor places a bid; the notebook preserves the explored
target and original forecast. A human-requested hint can compare trumps even
behind a partner's bid, while live computer partner passes remain immediate.

Vite bundles Zeb's WASM URL explicitly. The existing service worker caches both
players from first launch, including the worker code and WASM. Validation:

```sh
npm run typecheck
npm test
npm run build
npm run test:offline:browser
npm run test:zeb:browser
# With a rooms-enabled build served by Wrangler:
PLUNGE_ROOM_PLAYER=Zeb PLUNGE_ROOM_URL=http://localhost:8788/ npm run test:rooms:browser
```

The Zeb browser check selects the player through Settings, reloads offline,
saves real bidding and move hints, plays a full hand, checks action identities and
saved Zeb receipts, and
verifies the service-worker update. These are automated Chromium checks, not a
physical-device performance claim.


## Identity, history and more characters

`src/ai/players.ts` is the shared registry for names, character ids, package
versions, receipt names, deal policy and Nel-O capability. Persisted selection
ids remain compatible with existing saves. A character is separate from its
implementation: a future profile can use `character`, while statistics and
receipts use the recorded version and artifact identity. No profile service or
dynamic package loader is needed today.

Each executed computer action records an identity event, including passes and
Nel-O cover. Changing players during a hand produces a mixed hand; undo removes
only the undone events from the current attempt. Earlier history remains intact.
Hand summaries, exports and account counts use these events, never today's menu
choice or an invented version for an older save. Account counts include attempts;
a mixed hand appears under each implementation used and is not a strength rating.
The existing database column `walt` remains for compatibility; new identity data
lives in the versioned hand payload, requiring no database migration.

Family rooms carry original decision receipts to every connected phone. A rotated
view gets a separate content id and `perspective.sourceId` pointing to the original;
request seats, public plays, leader, inactive seat and team points rotate together.
Both forms stay in local exports. This lets a non-runner save a question about the
actual move instead of inventing a fresh analysis. Legacy rooms without full
receipts cannot recover evidence that was never sent.

To add or update a player:

1. Pin the package and lockfile. Zeb's displayed version and wire identity come
   from its installed package metadata; the worker verifies its reported version.
2. Add/update the registry descriptor. Keep the character id stable across
   releases; distinguish policies using selection ids and artifact identities.
3. Wire an adapter into `computerAuction`, `nativeMove` and `getHint`. The adapter
   receives only the actor's hand and public history, supports cancellation,
   returns legal actions, and records its real evidence. A new package API needs
   this adapter; registry metadata alone cannot make arbitrary packages playable.
4. Declare unsupported contracts and the visible fallback. Select shuffled or
   catalogue deals explicitly. Extend the pure evidence validator and score
   renderer if the model returns a different kind of estimate; do not invent
   completed-game counts from weighted predictions.
5. Run adapter/provenance/room version tests, both offline browser checks and the
   family browser check for each selectable player. Verify the service worker
   includes the package worker and WASM. Inspect the deployed preview's build id.

Profiles, portraits and different characters in each chair can be added later.
Today one selection controls the computer chairs, preserving the existing game
and family voting model.
