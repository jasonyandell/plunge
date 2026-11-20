# GameConfig flow survey (plunge-mods @ mods-work, 97c6ef8)

Read-only. Paths relative to /Users/jason/code/plunge-mods.

## 0. Presets (src/engine/types.ts)
- `GameConfig` 13 fields: types.ts:34-60. Option 14 (renege) is a comment only (:59). Matrix option 1's
  "Points to 250" mode has **no field**: only `targetMarks` exists (:35).
- CASUAL_CONFIG :65 (nello open, plunge, splash on) · TOURNAMENT_CONFIG :82 (straight 42) ·
  LEGACY_PLUNGE_CONFIG :93 (= tournament + allPass 'force-30') · PLUNGE_CONFIG :95 (= legacy + nello 'open').
- Engine default when no config is passed: `newGame(config = CASUAL_CONFIG)` src/engine/game.ts:65.

## 1. Where a game's config is chosen
**Solo (src/ui/store.ts)**
- `Settings.preset: 'casual'|'tournament'` :56-66 (default 'tournament'), `nelloEnabled` (default true).
- `tableConfig(settings)` :85-88: native players (Walt/Zeb, i.e. every selectable player) get
  `PLUNGE_CONFIG` if `nelloAvailable` else `LEGACY_PLUNGE_CONFIG`. `preset` is only read for non-native
  difficulties (`configFor` :76-78, then forces nello 'off').
- `nelloAvailable` :81-83 = `nelloEnabled && isNative(difficulty) && !NATIVE_TABLE` (Mac-gym build never offers Nel-O).
- **The preset is effectively dead:** non-native saves are discarded on load (`initialApp` :218); player
  switches force `preset:'tournament'` (:395, :402); no UI dispatches `set-preset` (reducer :406-409 only).
- Applied at: `new-game` :436-438; every `next-hand` :461-463; and `configureAuction` :91-94, which rewrites
  `game.config` only while phase is bidding/declaring (contract in play keeps its rules).
- **`?nello=` trace:** `initialApp` :219-222 reads `?nello=on|preview|counterexamples` → `nelloEnabled:true`,
  `off|ordinary` → false, overriding the saved setting; then `configureAuction` re-stamps the saved game (:223).
  Home toggle src/ui/Home.tsx:249-263 (hidden when NATIVE_TABLE) writes `?nello=on|off` into the URL via
  `history.replaceState` (:254-256) and dispatches `set-nello-enabled` (:257) → reducer :410-414 re-stamps the
  auction; if a Nel-O hand is already being played, `nelloPaused` (:96-98) sends you home with
  "Your Nel-O hand is saved" (Home.tsx:172). Human Nel-O declares are refused when unavailable (:457).
  Persisted as `settings.nelloEnabled` (loadApp :602, :624). So the only user-changeable rule today is
  PLUNGE_CONFIG vs LEGACY_PLUNGE_CONFIG (nello 'open' vs 'off').
- Room snapshot overrides the local setting: `nelloEnabled: t.game?.config.nello === 'open'` :374.

**Rooms (worker/)**
- `startGame` always `newGame(PLUNGE_CONFIG, seed)` worker/rooms.ts:207. No vote kind for rules
  (worker/room-votes.ts:10-19: player/start/restart/next-hand/undo/open/close/kick).
- `roomAuctionConfig` worker/room-undo.ts:9-11 forces `nello:'open'` on any auction-phase game; applied every
  next hand (rooms.ts:216), on undo restore (room-undo.ts:65) and on room upgrade (room-undo.ts:22).
**Other paths**
- Stats demo: `newGame(PLUNGE_CONFIG, …)` src/stats/demo.ts:8. Scripts: TOURNAMENT_CONFIG scripts/auction-study.ts:39.
- Harness (tests): config parameter, src/ai/harness.ts:45.
- Scenarios/replays/questions/share links: config comes from the replay code's preset char (see §5) via
  `decodeReplay` (src/ui/share.ts:29, src/ui/App.tsx:203-222, src/questions/model.ts:56, src/history/review.ts:39).
  No src/ui/demos on this branch.
- Walt prepared deals: `catalogueDeal` uses `newGame(game.config, …)` src/ai/catalogue.ts:11 (src/ai/player-game.ts:6-7).

## 2. Rooms: config carriage and validation
- `RoomState.game: GameState` (src/room/protocol.ts:57) carries `game.config` to every client in each snapshot;
  clients render from it (store.ts:374; src/room/view.ts:7 rotates without touching config).
- Server validates every move against the room's own game: `legalActions(game).find(...)` worker/rooms.ts:447
  ("That move is not legal at this table"); `applyAction` in `advance` :214. legalActions reads `game.config`,
  so yes, config is enforced server-side. Computer moves (run on the `runner` client, src/room/useRoom.tsx:205-219)
  must also carry a receipt whose request equals `playRequestOf(observe(game,…))` rooms.ts:451-460, and auction
  evidence of the expected schema :450. `modelKey` pins the player version :442-444.
- Config is not a room property: it's whatever the game holds; the server re-stamps nello each hand.

## 3. Engine implementation per option (all reads are in bidding.ts / game.ts)
| Option | Read at | Status |
|---|---|---|
| targetMarks | game.ts:511 | full |
| allPass | bidding.ts:50 (forced turn), :104 (forced Nel-O bid) | full (3 values) |
| nello | game.ts:210 ('open' → declaration); bidding.ts:104 (`!=='off'` for forced bid) | 'forced-only' only works together with allPass 'force-30-or-nello'; otherwise it behaves as off. No explicit branch. |
| nelloMinMarks | bidding.ts:106, game.ts:210 | full |
| nelloDoubles | game.ts:181-190 | full (4 values) |
| plunge / plungeMarks | bidding.ts:92-101 | full |
| plungeFirstLead | game.ts:432 | full |
| splash / splashMarks | bidding.ts:82-89 | full |
| sevens | game.ts:213, play rule :226-237 (`sevensLegal`) | full |
| noTrumpDoubles | game.ts:171-178 | full (3 values) |
| forced30SweepBonus | game.ts:312-321 | full |
No TODO/FIXME/unhandled branch in src/engine (grep empty). Points-to-250 (§8.6) is not implemented at all.

**UI per option:** in-game sheets are generic (they render whatever legalBids/legalDeclarations return:
src/ui/sheets.tsx:90-151 special bid chips with hints :167-; declare buttons :207 incl. sevens/nello);
wording covers noTrumpDoubles/nelloDoubles labels (src/ui/wording.ts:60-75) and plunge/splash/sevens (:16-43).
**Settings UI exists only for Nel-O on/off** (Home.tsx:249-263). Every other option has no setting.

## 4. AI readiness per option
Product players are only Walt (`native-partner`, `native-l1`) and Zeb: src/ai/players.ts:6-19
(`SELECTABLE_PLAYERS` :19). easy/medium/hard/onyx/walt-legacy remain for tests/harness only (store.ts:399-400, :218).
Scope gates ("unsupported" equivalents):
- `getBiddingHint` → 'unsupported' when `noTrumpDoubles!=='high'` or declaring a non-Walt contract: src/ai/bidding-hint.ts:24-26.
- `waltContractBid` null for plunge/splash/sevens: src/ai/walt/requests.ts:99-105; `waltDeclId` null for sevens :81-82.
- `playRequestOf` null for those contracts and for Nel-O unless `nelloDoubles==='own-suit'`: requests.ts:142-148.
- `requestOf` throws "Walt does not support this contract." src/ai/native.ts:73-75 (Walt and Zeb play both go through it, :148-150).
- `auctionRequest` throws "This contract is outside straight 42." src/ai/auction.ts:32-34 (Walt declaring after a plunge/splash).
- `zebPosition` throws "Zeb does not play Nel-O." src/ai/zeb/index.ts:22; `effectivePlayer` swaps Zeb→Walt for Nel-O, players.ts:25-28.
- `explainScope` src/ai/review-request.ts:7-15 gates MoveHint (src/ui/Table.tsx:205) and Review (src/ui/Review.tsx:43).
- Failures surface as an error banner and the table stalls (src/ui/App.tsx:152,160,297; room: useRoom.tsx:219 "stopped").

| Option | Walt (book + live auction + play) | Zeb | medium/hard (test-only) | Hints |
|---|---|---|---|---|
| plunge/splash | never bids specials (book-auction.ts:7, auction.ts:27-29 `special → null`); can't declare/play them (throws) | never bids specials (zeb/index.ts:41-42); can't play (throws) | bids them (medium.ts:117-124) and plays | bid hint 'unsupported' when declaring; MoveHint hidden |
| sevens | never declares it (prices only decls 0-7,9: auction.ts:46, bid-book.ts:31); can't play (throws) | never declares; can't play | plays `legal[0]` (medium.ts:398); never declares it | hidden |
| nello open | never bids/declares Nel-O itself; plays as declarer-side/defender only when nelloDoubles 'own-suit' (requests.ts:144) | covered by Walt | bids+declares (medium.ts:131-160, 195-199) | Walt hint ok for own-suit |
| nello forced / force-30-or-nello | `special` forced bid never chosen; plays human's forced Nel-O if own-suit | same | yes (medium.ts:135-139) | — |
| nelloDoubles ≠ own-suit | play throws | — | uses buildRules(cfg) | hidden |
| allPass force-30 | handled: book survey `forced` (book-auction.ts:29) | engine forced min (zeb/index.ts:50) | yes | ok |
| noTrumpDoubles 'low'/'own-suit' | **not gated in play**: decl 9 is sent with no doubles mode (requests.ts:77-78, walt.ts:20); Walt assumes straight-42 follow-me. Only checkedAction's legality test (native.ts:121-123) would catch an illegal pick; a legal-but-wrong-rules play passes. Book panels are straight-42 prices. | same path | rules-aware (evaluate.ts uses buildRules) | bid hint 'unsupported'; **MoveHint not gated** (explainScope ignores it) |
| plungeMarks/plungeFirstLead/splashMarks | n/a (never in a plunge) | n/a | yes | — |
| forced30SweepBonus | unaware (make/set objective only) | unaware | unaware | — |
| targetMarks | unaware of match score | unaware | unaware | — |
Net: Walt/Zeb are straight-42 + own-suit Nel-O players. Only PLUNGE_CONFIG/LEGACY_PLUNGE_CONFIG are safe to deal.

## 5. Persistence
- Solo save: `toSaved` store.ts:556-560 stores the whole `GameState` (config included) + `settings`
  (preset, nelloEnabled). `loadApp` :592-627 validates settings and game shape but **not config fields**.
  `initialApp` re-stamps config only in auction phases; a game mid-play keeps its saved config until next hand.
- Replay code: `v1` + one preset char `c|t|f|l` + shaker + dealt (replay-code.ts:86-88; decode :98-109).
  `presetOf` :22-26 matches by `JSON.stringify` equality (key order and every field). A non-preset config
  "reads as casual", re-simulation then disagrees, and `encodeReplay` returns **null**.
- Consequences of null: hand records are dropped (`handRecordOf` src/history/legacy.ts:55-56, so no stats
  upload/room history: worker/rooms.ts:115); history snapshots fall back to raw `engineState`
  (src/history/recorder.ts:12-19); share links/observation links/questions unavailable (src/ui/share.ts:25-37,
  src/questions/client.ts:33). Stats dedupe keys include the preset char (src/stats/model.ts:48-55).
- **Would a config change break old saves?** Adding a GameConfig field: old saved/room games lack it
  (undefined read by engine) until re-stamped at the next auction; `presetOf` equality then fails for any
  in-play hand from an old save → that hand's replay code/record is lost. Changing a preset's values changes
  what old `c/t/f/l` codes decode to (codes do not embed options), silently reinterpreting history.
  Rooms: `upgradeRoom` only patches nello (room-undo.ts:18-24). A new option needs its own preset char or an
  encoded options segment, plus a default-filling upgrade on load (store loadApp, room upgradeRoom).

## 6. Computer-player identity seam
- Registry: `PLAYERS` src/ai/players.ts:6-15 with `capabilities: { bidding: 'recorded-hands'|'forecast', nello }`;
  `effectivePlayer` :25-28 is the existing capability fallback (Nel-O → Walt). `playerKey` :37 (id@version:impl)
  pins the wire version.
- Solo: `settings.difficulty` (store.ts:59), PlayerPicker (src/ui/PlayerPicker.tsx:27,38 reads `capabilities.nello`),
  `set-difficulty` → `planPlayerChange` (src/ai/player-change.ts:7-11; switching mid-game ends the game).
- Rooms: `room.state.player` + `modelKey` (rooms.ts:91, :274); vote kind `player` (room-votes.ts:11; rooms.ts:265-275, :413-421).
- Dispatch: auction `computerAuction` src/ai/computer.ts:6-14 (table keyed by PlayerId); play `nativeMove`
  src/ai/native.ts:148-150 (Zeb branch inline). Callers: src/ui/App.tsx:145,156; src/room/useRoom.tsx:212-215;
  src/stats/practice-computer.ts:15-16. Deal source: `dealForPlayer` src/ai/player-game.ts:6-7.
- **PR 79 (`origin/codex/idea-69d52ac04be641059f95a7bcb6cfb5bc`)**: 6 files, +44/-1 (book-auction.ts +3,
  last-bid.ts +12, zeb/index.ts +3/-1, three tests). `cheapestLastBid(g, action)`: on the 4th bid of an
  auction (`bids.length===3`), if the chosen bid is points or plain 1-mark, replace it with the cheapest legal
  such bid. Wired inline into `bookAuction` (re-reads panel at new target) and `zebAuctionAction`.
  It is a post-filter `(g, chosenAction) → action` over the policy's output. Not wired into the live-Walt
  path in auction.ts. It changes recorded auction evidence (survey.bid), so it changes the game for the
  whole table. docs-mods-coupling.md:55-56 already parks it as "needs a table scope and room agreement".
  Mods today are `scope: 'device'` only (src/kernel/mod-api.ts:122-129; src/kernel/mods.ts:1-25).

## 7. RULES.md §9 matrix (docs/RULES.md:284-309)
1 game mode (marks 7 / points 250) · 2 all-pass · 3 Nel-O · 4 Nel-O min · 5 Nel-O doubles · 6 Plunge ·
7 Plunge value · 8 Plunge first lead · 9 Splash · 10 Splash value · 11 Sevens · 12 follow-me doubles ·
13 forced-30 sweep · 14 renege. Presets: Tournament, Casual (:304-308).
Documented but not covered by GameConfig: §8.6 "game to 250" (:260-273: 30-41/42/84/168 doubling ladder,
both-teams-score, Low-No worth 42, forced shaker). That is the "84" in RULES; option 1 lists it but there is
no field. §8.7 (:275-282) out of scope: Moon (3-player, shoot the moon), 80/88 (6-8 players), Celko double-8.
"Low Boy" = Nel-O synonym (:190). §8.5 forced-bid package (:254-258) is options 2+13. Renege penalty (14) is
not a config. No other variants in docs.

## What a gameplay mod would need from the kernel
1. **Config contribution, not config mutation.** A mod declares a partial `GameConfig` (or a named rule pack)
   plus a stable id; the kernel composes base preset + enabled rule mods into one config at exactly the existing
   stamp points (`tableConfig` store.ts:85, `startGame` rooms.ts:207, `roomAuctionConfig` room-undo.ts:9).
   New rule fields need engine support first; most §9 options already work (§3).
2. **Table scope carried in room state.** A new `scope: 'table'` in ModManifest; the enabled rule set lives in
   `RoomState` (protocol.ts:54) and changes only by a room vote (new ProposalKind in room-votes.ts, ends the game
   like `player`). The server already enforces whatever `game.config` says (rooms.ts:447), so carriage is
   enough for legality; the server must compose the config itself, never trust a client's.
3. **AI capability gating.** Extend `PLAYERS[...].capabilities` (players.ts:6-15) from `{bidding, nello}` to the
   rules each player handles (specials, sevens, noTrumpDoubles, nelloDoubles), and refuse (or fall back
   like `effectivePlayer`) before a deal, not mid-hand. Fix the ungated noTrumpDoubles hole in
   `playRequestOf`/`explainScope`. Hints use the same check.
4. **Persistence identity.** A replay/record header that encodes the composed rule set (preset char + mod
   options, or a rules hash), and default-filling on load (loadApp, upgradeRoom) so old saves and codes
   keep meaning what they meant.
5. **Computer-player mods** (PR 79 shape): a kernel hook `adjustComputerAction(g, seat, action) → action`
   applied in one place (`computerAuction` computer.ts:11 / `nativeMove`), table-scoped like rules, recorded in
   `playerEvents`/`modelKey` so receipts and room version checks (rooms.ts:442) know which variant played.
