# Plunge: whole-project review (branch `mods-work`, 2026-10-31)

Read-only review of `/Users/jason/code/plunge-mods` (141 commits, 391 tracked files). I read every file in
`src/`, `worker/`, the kernel and mods, skimmed `scripts/` and `tests/`, and ran the vitest suite once
(540 tests, 80 files, all green). I did **not** run `npm run build` or the browser scripts, because they write
`dist/` and wrangler state. Import claims come from a resolver I ran over every `import`/`export from`/`new URL`.
Where I'm unsure I say so.

**The short version.** The engine is clean and stands on its own. The kernel already exists, but it is spread
across `src/ui/store.ts`, `src/room/useRoom.tsx`, `src/ai/native.ts` and `worker/accounts.ts`. About 2,300
lines of AI and review code never run in production and still cost CI time. There are three separate game
loops, seven copies of the same worker helpers, and one auth table that is really the ideas table. The mod
slice is a good shape, but its boundary only checks imports, and the re-exports in `mod-api` reach most of core.

---

## 1. Shape of the project

TS/TSX/CSS/MD lines, binaries excluded. Total: src TS/TSX 14,469 · worker 2,197 · tests (TS) 10,594.

| Area | Lines | What it is for | Notes |
|---|---:|---|---|
| `src/engine` | 1,320 | Rules, deal, legality, replay codes | No imports outside itself. The best code in the repo. |
| `src/ai` (all) | 3,981 | Walt (wasm in a worker), Zeb (npm WASM), bid book, auction pool, hints | **~2,050 never run in prod** (§3.1). `book/played.json` is 572 KB. `phone/walt-player.wasm` is 6.3 MB. |
| `src/ui` | 5,576 (1,591 CSS) | Shell, store, table, sheets, home, review, questions UI | `store.ts` 695 and `Table.tsx` 546 are the hubs. `Review.tsx` 284 is dead. |
| `src/room` | 1,045 | Family-table client: socket, lobby, votes, history | `useRoom.tsx` (396) is socket, session, AI runner and all the UI at once. |
| `worker/` | 2,197 | One Worker: assets, accounts, ideas, rooms DO, stats, questions, MCP | rooms 929 · ideas 568 · accounts 287 · mcp 198 · stats 116 · index 89 |
| `src/ideas` | 1,154 | Idea board, screen-idea long press, previews, demo | `QuickIdea` is mounted on every page (`src/main.tsx:29`). |
| `src/account` | 539 | Passkey UI, identity chip, invite demo | Imports the ideas client (`Account.tsx:5-16`). |
| `src/stats` | 574 | Stats page, replay, "play again" practice | Imports `ui/Table`, `ui/sheets`, `room/view`, `ideas/QuickIdea`. |
| `src/history` | 542 | IndexedDB hand log, snapshots, stats upload | The live hand log is in `legacy.ts`, and the worker imports it. |
| `src/questions` | 459 | Question notebook: storage, sync, hint evidence | `mode.ts` holds the build-mode flag that everything else reads. |
| `src/kernel` + `src/mods` | 351 + 871 | Mod loader, slots, store; 11 mods | Clean, small, well tested. |
| `scripts/` | 3,683 | CI/deploy helpers, preview tooling, idea builder (706), 13 browser checks | Python and Node mixed. |
| `tests/` | 10,594 | 80 vitest files | ~850 lines test dead code (§4). |
| docs | ~2,800 | 9 root `docs-*.md`, 10 `docs/*.md` | README is stale (it says "Advanced settings keeps L1"; L1 is not selectable, `src/ui/PlayerPicker.tsx:25`). |

### Dependency graph (area → area, number of import sites)

```
engine  ← everyone (no outgoing edges)
ai      → engine(22) ai/walt(10) ai/phone(7) ai/zeb(4) ui(1: native.ts:10 BUILD_ID)   ai/zeb → ui(1: zeb/index.ts:7)
ui      → ai(41) engine(35) questions(12) room(9) kernel(5) history(4) ai/walt(3) account(1) ideas(1)
room    → ai(10) ui(7) engine(6) history(2) account(1) kernel(1) questions(1) worker(1!)
kernel  → ui(5) ai(3) mods(3) engine(2) questions(1) room(1)
history → engine(6) ai(5) ui(3) questions(1) room(1)
stats   → engine(11) ui(6) ai(4) history(4) ideas(1) room(1) questions(1)
account → history(2) ideas(3) questions(3) room(2)
worker  → ai(10) engine(7) ideas(4) history(3) room(3) questions(1) ui(1, type-only)
```

**Cycles and surprising edges:**
- **Value-level cycle between `ui/store` and `room/view`.** `src/ui/store.ts:39` imports `rotateGame` from `room/view`, and
  `src/room/view.ts:4` imports `initialApp, DEFAULT_SETTINGS` from `ui/store`. At the area level, ui↔room is a cycle
  through `useRoom → ui/store, ui/PlayerPicker` and `App → room/useRoom`.
- **kernel ↔ ui cycle.** `kernel/mod-api.ts:8-9` re-exports `ui/Domino` and `ui/wording`. `kernel/advice.ts` re-exports
  `ui/BookDetails` and `ui/ForecastDetails`, which import `SEAT_NAMES` (a mutable module `let`, `store.ts:51`)
  and `SaveHint → questions/client`, which does network and IndexedDB work. Core in turn imports `kernel/Slot`.
  So a mod importing only `mod-api` still transitively loads `ui/store.ts`, the question uploader and Walt's
  request builders.
- **Client imports server code.** `src/room/VoteBar.tsx:5` imports `neededYes` from `worker/room-votes.ts`.
- **The AI layer depends on the UI** just for a build constant: `ai/native.ts:10`, `ai/zeb/index.ts:7`,
  `questions/client.ts:6`, `ideas/client.ts:2` and `history/recorder.ts:4` all import `BUILD_ID` from `ui/update.ts`.
- **The worker bundles the 572 KB bid book.** `worker/rooms.ts:9` → `ai/player-game` → `ai/catalogue` →
  `ai/bid-book`. `bid-book.ts:46` runs `validateBook(data)` at module load, so every Worker cold start parses and
  validates it, even for `/api/account`. The rooms code only needs `BID_BOOK.seeds`.
- **`ui/store.ts` is the hub.** It has 25 production importers (the worker's `room-undo.ts` included) and 21 test
  importers. It holds the reducer, rollback, persistence, the seat-name global, end-card copy, and
  re-exports of `wording` and `hand-history`.
- **`stats` pulls in all of `ui/Table.tsx`** (`ReplayPane.tsx:6`), so the lazy stats chunk carries the table.

---

## 2. What is the kernel, honestly

Legend: **K** kernel · **B** built-in mod (default on) · **F** family-mod candidate · **I** infrastructure ·
**D** dead or doubtful. Difficulty: S < 1 day, M a few days, L about a week or more.

| Cluster | Class | Seam needed to get there | Diff |
|---|---|---|---|
| `src/engine/*` | **K** | None. Add `rotateGame`/`relativeSeat` here as `engine/view.ts`; they are pure seat math now in `room/view.ts`. Make `newGame`'s default config explicit: it defaults to `CASUAL_CONFIG` (`game.ts:65`), which the product never plays. | S |
| `ui/store.ts`: reducer, epoch, `rollbackTarget`, `liveDispatch` | **K** ("table session") | Split into `kernel/table/{reducer,rollback,persist}.ts`. Replace `SEAT_NAMES`/`setSeatNames` (`store.ts:51-54`) with a `names` field on the state or props. Move the `handOverCopy`/`gameOverCopy`/`thinkingCopy` strings (`:641-691`) to `ui/`. Delete `Preset`/`set-preset`/`configFor`/`CASUAL` (no UI dispatches `set-preset`) and the `'ai'` event (§3.1). | M |
| `ui/App.tsx` | **K** (shell) | It is three things: the turn driver (`:126-176`), persistence and history effects (`:39-109`, `:181-185`), and link routing (`:187-226`). Turn driver → kernel `turns.ts` shared with rooms and practice. Routing → kernel `routes.ts`. The update banner can be a B mod. | M |
| `ui/Table.tsx` | **K** felt + slots | It is already mostly slots. Still to lift out: MoveHint gating (`:205-206`), question select/bookmark/toast (`:122-137`, `:237-239`), `GameMenu`'s hints switch and "Share an idea" (`:303-307`), end-card `modelSummary`/practice props. Needs `hand-heading`, `trick-tap`, `menu-item`, `end-card` slots. | M |
| `ui/sheets.tsx` | **K** | The bid/trump controls are core. End cards keep `gameover-header`; add `handover-footer` for review/history/undo links. | S |
| `ui/Home.tsx` (Home/More/HowTo/About) | **K** frame + B entries | `home.entry` (tiles) and `more.section` slots. `FamilyEntry` and `FamilyTile` are duplicates (`:40-100` vs `:113-154`: same `openFamilyTable`, same polling). Settings → per-mod sections. | M |
| `ai/players.ts`, `phone/*`, `walt/requests.ts`, `observation.ts`, `zeb/*`, `auction*.ts`, `bid-book.ts`, `computer.ts`, `native.ts` | **K** player contract + **B** player packages | Today "the player" means `if (difficulty === 'zeb')` in `native.ts:147`, a table in `computer.ts`, `effectivePlayer === 'zeb'` in `ai/hint.ts:24`, and capability flags in `players.ts`. The seam is `interface ComputerPlayer { id; capabilities; deal?; auction(obs); play(obs); estimate?(obs) }` registered with the kernel. Walt and Zeb become two packages behind it. They are **not** device-toggle mods: a table needs everyone on one player. | L |
| `ai/native.ts` `api()` (`:83-107`) | **D/K** | A fake HTTP router: `receipts/…` goes to IndexedDB, `estimates` goes to a worker, anything else throws "needs the Mac gym". Split into `receipts` (kernel storage) and `estimate` (player contract). | S |
| `ai/{easy,medium,hard,evaluate,onyx,onyx-features,harness,table,index}.ts`, `ai/walt/{index,explain,worker}.ts`, `walt.wasm`, `ui/Review.tsx` | **D** | Delete (§3.1). | S |
| `ai/hint.ts`, `ui/MoveHint.tsx`, `MoveScores`, `SaveHint` | **B** `move-hint` | `hand-heading` slot plus `moveAdvice(g, player, worlds, signal)` in `kernel/advice.ts`, as `docs-mods-coupling.md` already proposes. | M |
| `room/protocol.ts`, `room/client.ts` (RoomConnection), `worker/rooms.ts`, `room-undo.ts`, `room-votes.ts` | **K** (comms) | Already reasonably clean on the server. Move `HandRetry` out of `ui/store` (protocol imports it, `protocol.ts:5`). Remove `client.ts:5` `ROOMS_ENABLED`. Add per-socket redaction (§3.4). | M |
| `room/useRoom.tsx` | **K** session + **B** `family-table` UI | Split it. (a) Session: credentials, socket, knock state machine, runner loop, dispatch routing (`:65-305`). (b) Chrome: lobby, invite, table dialog, VoteBar, Doorbell, sign-in offer (`:306-395`) behind `table.chrome`/`screen` slots. Today the hook returns JSX (`RoomShell.chrome/screen/overlays/menu`), so it is an un-slotted mod already. | M |
| `room/{VoteBar,ActiveTables,RoomHistory}.tsx`, `room.css` | **B** | They come along with the `family-table` UI. | S |
| `history/{recorder,legacy,stats-sync,hand-record,review}.ts` | **K** storage (hand log) + **B** stats sync | The hand log is the kernel's "what happened" record, shared by stats, review and export. Rename `legacy.ts` → `hand-log.ts`. Upload (`stats-sync.ts`) is an account-tied B mod. | S |
| `stats/*` | **B** `stats` screen | Needs `screens` + `home.entry`. It must stop importing `ui/Table` internals: export `Felt`/`Seat` presentational components from kernel. Practice runner → kernel turn driver. | M |
| `questions/*`, `ui/Questions.tsx`, `SavedHint.tsx`, `MoveQuestionPrompt.tsx`, `worker/index.ts` questions handler | **B** `question-notebook` | Needs a `trick-tap` slot (the played-domino tap, `Table.tsx:191`, `:405`), a screen, and `#question=` route registration. Server: move the inline handler out of `worker/index.ts:46-87` into `worker/questions.ts`. | M |
| `ui/NativeReview.tsx`, `NativeStats.tsx`, `CounterexampleScores.tsx`, `observation-link.ts`, `share.ts` | **B** `review` | Needs an end-card slot plus a `#r=`/`#q=` route. The `NATIVE_TABLE` branches (`NativeReview.tsx:57-167`) are D (§3.3). | M |
| `ui/SoloHistory.tsx` | **B** | `handover-footer` + `menu-item` slots. | S |
| `ideas/*` (board, composer, screenshots, QuickIdea, previews) | **B** `ideas` | Needs `screens`, `home.entry`, and a kernel "busy" signal in place of the `plunge-idea-active` window event (`QuickIdea.tsx:31`, `App.tsx:87-92`). The global long-press listener (`QuickIdea.tsx:42`, `:56`) becomes the mod's own document listener, behind a kernel gesture-ownership rule (§7). | M |
| `ideas/IdeasDemo.tsx`, `account/AccountDemo.tsx`, `stats/demo.ts` | **D** or **F** | Walkthroughs reached by `?demo=` in `main.tsx:23`. Delete the two UI demos. Keep `demoHands()` as a test fixture. | S |
| `account/*` UI | **B** `account` screen | Passkey ceremony client stays K (`kernel/auth`). The page is a mod. Cut its imports of ideas internals (`Account.tsx:5-16`, `:191` preview grant). | M |
| `worker/accounts.ts` | **K** auth | Family access **is** `idea_members.revoked=0` (`accounts.ts:22-23`, `grantFamily` `:60-69`; also `stats-browse.ts:7`, `rooms.ts` through `accountSession`). The kernel's auth depends on the ideas schema. Add a `family` column/table owned by accounts. | M |
| `worker/ideas*.ts`, `idea-releases.ts`, `scripts/ideas/*`, `preview.yml`, `scripts/preview.mjs` | **I** (ideas service) | Server-side infra for the B `ideas` mod. See §5. | — |
| `worker/mcp*.ts`, `account/connection.ts`, `docs/CHAT-COMPANIONS.md`, `scripts/{prepare-mcp,production-profile,test-mcp-browser,test-prepare-mcp}.mjs` | **D** (parked) | Production deploys the `core` profile, so these routes answer 503. But `wrangler.toml:5` makes `mcp-entry.ts` the main, so every request is wrapped by it and pulls in OAuthProvider, MCP and zod. Park it on a tag and make `worker/index.ts` main. | S |
| `src/kernel/*` | **K** | Keep. Add `routes`, `screens`, `storage` (§6). | — |
| Mods: `domino-counter`, `partner-badge`, `flash-let-in`, `vote-notice`, `nello-sitout-view`, `drag-arrange`, `cherry-blossoms`, `winner-congrats`, `shuffle-flourish`, `birdwatcher` | **F** | Done. `bidding-hint` is **B**. | — |

**What NOT to make a mod:**
- the engine;
- the reducer and epoch (a stale-tap guard has to be global);
- undo/restart semantics (shared with room votes in `room-undo.ts`);
- the room coordinator and protocol;
- passkeys and sessions;
- storage primitives;
- the player contract and the Walt/Zeb runtimes;
- anything that changes the game for the whole table (rule variants, `ai.bid.adjust`). That needs a *table* scope agreed by vote, not `scope: 'device'`;
- the seat-reveal policy at shared tables (security).

---

## 3. Rot and risk

### 3.1 AI code that production never runs
- **Every selectable player is "native".** `SELECTABLE_PLAYERS = ['native-partner','zeb']` (`ai/players.ts:20`).
  `initialApp` discards any save whose difficulty is not native (`store.ts:218`). So in `App.tsx:141-163` the
  `dispatch({type:'ai'})` branch can only fire when `pendingAiSeat` returns a seat outside bidding, declaring and
  playing, which it never does.
- That means `store.ts:497-509` (`'ai'` case), `ai/table.ts`, `hard.ts` (192), `medium.ts` (424) and `evaluate.ts`
  (206) are **bundled but dead**.
- `easy.ts`, `onyx.ts` (301), `onyx-features.ts` (274), `harness.ts`, the runtime part of `ai/index.ts`, and the old
  solver `ai/walt/{index,explain,worker}.ts` with `walt.wasm` (302 KB) are reachable **only from tests**. The one
  production caller of `walt/explain`, `src/ui/Review.tsx`, is imported by nothing.
- **`public/models/onyx.onnx` (1.2 MB) is deployed** to the site for no reader. The service worker skips it
  (`vite.config.ts:26`), but `wrangler deploy` uploads it. The `onnxruntime-web` dependency and its alias
  (`vite.config.ts:59-63`) exist only for this.
- **The `isNative()` checks are always true.** There are 11 call sites (`store.ts:82,86,218,402,436,463,486`,
  `App.tsx:113,141,154`, `Table.tsx:205`), and the `DIFFICULTIES` list (`store.ts:589`) still names easy, medium,
  hard, onyx and walt.

### 3.2 Two (or more) ways of doing the same thing
- **Three game loops.**
  - Solo: `App.tsx:130-176` with `computerAuction`/`nativeMove`.
  - Rooms: the runner in `useRoom.tsx:201-222` with the same calls plus `checkedAction`.
  - Stats practice: `stats/practice-computer.ts`, which **hard-codes Zeb** (`:15-16`) even for hands first played against Walt.

  Three copies of turn, abort, retry and thinking-state handling.
- **Two undo implementations.** `store.ts:291-337` (`rollbackTarget`) and `worker/room-undo.ts:53-81`
  (`roomUndoTarget`), each with its own `canonical()` (`store.ts:275`, `room-undo.ts:49`).
- **Seven copies of each worker helper.** `json()` in `http.ts`, `index.ts`, `rooms.ts`, `accounts.ts`, `ideas.ts`,
  `ideas-preview.ts` and `idea-releases.ts`. A bounded body reader in `http.ts`, `index.ts`, `rooms.ts`,
  `accounts.ts`, `ideas.ts`, `ideas-preview.ts` and `mcp-entry.ts`. Random-hex generators in `rooms.ts:57`,
  `accounts.ts:16`, `ideas.ts:275`, `questions/storage.ts:20`, `room/client.ts:75`, `stats-sync.ts:50` and
  `AccountDemo.tsx:15`. `worker/http.ts` was made to stop this; only `stats*.ts` uses it.
- **Three hand-link formats:** `#r=` (`ui/share.ts`), `#q=` (`observation-link.ts`) and `#flag=`
  (`App.tsx:206-216`). `#flag=` only works with the Mac gym. On a phone, `api('flags/…')` throws.
- **Link params are parsed in about 15 places, with no router.** Search params: `?stats ?account ?ideas ?idea ?demo`
  (`main.tsx:20-23`), `?rooms` (`useRoom.tsx:43`), `?mods` (`kernel/mods.ts:13`), `?nello` and
  `?settings=player` (`store.ts:219-225`), `?hand` (`StatsPage.tsx:13`), `?roomReturn` and `?ideaReturn`/`?ideasReturn`
  (two near-identical `account-return.ts` files), `?returnTo` (`Account.tsx:131`). Hash params: `#room=`,
  `#question=`, `#q=`, `#r=`, `#flag=`, `#invite=`, `#idea=`, `#try`, `#join=`, `#family=`, `#recover=`.
- **Several identities per device:** the question owner token (IndexedDB `plunge-questions/meta.owner`), the stats
  device id (`plunge-stats/meta.device`), the ideas invite (`localStorage plunge:ideas-invite`), the preview
  session (`sessionStorage`), room seat tokens (`plunge:room:<id>`), the room visitor id, and the account cookie.
- **Seat and relation math is spread out:** `relativeSeat` (`room/view.ts:5`), `(seat+r)%4` (`useRoom.tsx:145`), the
  literal `seat === 2 ? 'partner'` (`Table.tsx:149`), `% 2` team tests in `decision-stats.ts`, `native.ts:136` and
  `NativeStats.tsx:50`, and `(declarer+2)%4` in `review-request.ts:13` and `walt/requests.ts:145`. The engine
  already has `partnerOf`/`teamOf`.
- **The same history is written twice per change.** It is recorded inside the reducer (`App.tsx:45-50`, a side effect
  in a reducer) and again in an effect (`App.tsx:65-72`). Each call stages the **entire AppState JSON** into
  `localStorage` (`history/recorder.ts:73-77`) before IndexedDB, on top of `saveApp` (`App.tsx:181-185`).
  That means at least three synchronous full-state `JSON.stringify` writes per move, and `auctionSurveys` carries
  book panels. Content addressing stops duplicate records, but not the cost or the localStorage quota.

### 3.3 Flags, build modes and scattered guards
- **`PLUNGE_ROOMS` is vestigial.** CI, deploy and the family-rooms previews all build with `experimental`
  (`ci.yml`, `deploy.yml`). `off` is only the local-dev default. The comment in `env.d.ts` ("only in experimental
  previews") is wrong. Delete the flag.
- **`PLUNGE_QUESTIONS=local-only` really means "this is a PR preview".** `QUESTIONS_LOCAL_ONLY` is read by ideas
  (it switches the API base and auth scheme, `ideas/client.ts:14-41`), accounts (`me.ts:30`), rooms
  (`client.ts:53,60`), stats sync, and SaveHint. That is 14 files. Rename it to `BUILD_MODE: 'prod'|'preview'` in one
  `kernel/config.ts`.
- **`VITE_NATIVE_TABLE` (the Mac research transport) is never set by any workflow.** It branches 20 times
  (`native.ts`, `auction.ts:66`, `Home.tsx:172,249,265`, `NativeReview.tsx`, `NativeStats.tsx`, `App.tsx:113`), and
  the Vite proxy routes `/api` to `:4245` for it. If the Mac gym is not driven through Plunge any more, delete it.
  If it is, make it a dev-only mod.
- **The hosts are hard-coded in four places:** `accounts.ts:8`, `mcp.ts:7`, `ideas/model.ts:25`,
  `scripts/ideas/releases.mjs:4`.
- **Guards are scattered.** `scenario` appears 33 times in `Table.tsx` and 26 times in `store.ts`. `demo` appears
  around 120 times across the three demo pages. `scenarioGame` (a read-only shared hand) is threaded through every
  reducer case. It belongs in a separate read-only viewer, which is what `ReplayPane` already almost is.
- **Legacy shims to retire on a schedule:** `loadApp`'s `nelloPreview`/`nelloCounterexamples` (`store.ts:596-623`),
  `upgradeRoom`'s `admit` migration (`room-undo.ts:33-41`), `recordedPlayerLabel('room')`, the
  `readExistingDatabase('plunge-records'|'plunge-stats')` export (`recorder.ts:136-137`), and
  `AnalysisWorlds = 40|160|350|500|512` ("retain old saved estimates", `native.ts:15`).
- **Duplicate migration numbers:** `migrations/0004_family_table.sql` and `0004_idea_authorizations.sql`;
  `0005_idea_screenshots.sql` and `0005_listed_tables.sql`. Wrangler orders them by name, so they work, but don't
  rename applied ones. Add a uniqueness check for new ones.
- **The one D1 binding is called `QUESTIONS`** and holds accounts, sessions, ideas, hands and room listings.

### 3.4 Browser storage inventory (no migration framework; each store versions itself)

| Store | Keys / DBs | Owner |
|---|---|---|
| localStorage | `plunge:save:v1` | store |
| | `plunge:history:pending:<uuid>` (full AppState) | recorder |
| | `plunge:room:<id>`, `plunge:room:last` | rooms |
| | `plunge:offered-sign-in`, `plunge:me`, `plunge:name` | rooms, account |
| | `plunge:ideas-invite`, `plunge:idea-draft:screen`, `plunge:ideas-preview-signin:<state>` | ideas |
| | `plunge:ideas-demo:v1`, `plunge:account-demo:v1` | demos |
| | `plunge:play-again:v1:[demo,hand,seat]:<run>` | stats |
| | `plunge:mods:v1`, `plunge:mod:<id>:<key>` | kernel |
| sessionStorage | `plunge:ideas-preview-session`, `plunge:account-demo:me`, `plunge:account-demo:v1` | ideas, demo |
| IndexedDB | `plunge-history` (events), `plunge-stats` v2 (hands, analysis, meta, sync), `plunge-walt` (receipts), `plunge-walt-estimates`, `plunge-questions` (questions, meta), `plunge-idea-drafts`; read-only legacy `plunge-records` | 6 modules open 6 DBs |

Migration today means each loader tolerating old shapes (`loadApp`, `upgradeRoom`) and "never migrate, export
verbatim". That is fine for data, but there is no registry, so `exportHistory` (`recorder.ts:116-138`) hand-lists
which stores to back up. Ideas drafts, questions and mod stores are not in the export.

### 3.5 Security notes (report only, no fixes)
1. **Preview CI runs PR code before the steps that hold `CLOUDFLARE_API_TOKEN`.** `preview.yml:101` (`npm ci`) and
   `:105` (`npm test`) run the PR head's code in `app/`. The secret-bearing steps then run
   `node "$PREVIEW_TOOLS/preview.mjs" prepare` (where `PREVIEW_TOOLS` can be `app/scripts`) and
   `npx wrangler deploy` (`:131`) from `app/node_modules`. The builder's *limited* fence allows `tests/`
   (`scripts/ideas/builder.mjs:38`), so a test file can rewrite `node_modules/.bin/wrangler` or `scripts/preview.mjs`
   on disk, and the next step runs it with the token. That is a prompt-injection path from family idea text to the
   Cloudflare token. It is same-repo only and needs Codex to write hostile code, but the preview runs *before*
   human review. Fix shape: build and test in one job, upload `dist/` plus the worker bundle, and deploy from a
   trusted checkout with its own pinned wrangler.
2. **Rooms trust the runner client for computer seats.** `worker/rooms.ts:436-462` accepts any *legal* action for a
   Walt-driven seat from the runner. A receipt is optional, and when present it is only checked for consistency.
   This goes with the known "all hands to every client" (`protocol.ts:53`). Redaction is feasible: Walt and Zeb only
   use an `Observation`, so the coordinator could send each socket its own hand, give the runner only the hands of
   Walt-driven seats, and reveal everything at hand-over.
3. **Anyone can create rooms (Durable Objects) without limit:** `POST /api/rooms` (`rooms.ts:717`) has no auth and no
   rate limit. **`GET /api/rooms/live` is public** (`index.ts:42`) and lists family-opened tables with the first names
   of who is seated and the room ids. Tables start closed, but the names leak to anyone on the internet.
4. **The seat token travels in the WebSocket URL query** (`room/client.ts:100`), so it can end up in edge logs.
5. **`IDEAS_ADMIN_TOKEN` is reused** as the ideas builder admin (`ideas.ts:89`), the accounts admin (`accounts.ts:79`)
   and the HMAC key for preview grants (`ideas-preview.ts:56,76`). Leak one and you leak all three. Use separate keys.
6. **Stats are trust-the-client.** Any signed-in account can upload any legal replay as "played"
   (`worker/stats.ts:57-63`, validated only by replay). Solo hand ids are keyed by a client-supplied device id with
   first-write-wins (`stats.ts:21`, `INSERT OR IGNORE`). Fine for family; it matters if stats ever become public.
7. **The mod boundary checks imports only.** Mods run in the same realm and can `fetch`, read any `localStorage` key
   (the ideas invite, room seat tokens), or patch `document`. Each mod gets the full `game`, including other hands at
   shared tables. Family trust is the real fence. Say so in `docs-mods.md`.

---

## 4. Test health

- **Unit suite: 540 tests in 80 files, 19.4 s wall locally (4 cores), 74.5 s summed.** On CI it runs serially
  (`vite.config.ts:55` `fileParallelism: !process.env.CI`). The comment there says why: "hard's PIMC matches,
  walt's wasm solves" starve the RPC. Those are the **dead-code tests**.
- **Slowest files:** `ai-strength` 18.7 s (easy/medium/hard), `rooms-api` 16.0 s (Miniflare plus esbuild of the
  worker), `walt-play` 6.8 s (old walt), `room-stats` 6.4 s, `ai-legal` 6.0 s (dead), `ideas-api` 3.4 s, `ai-perf`
  2.7 s (dead), `onyx-play` 1.5 s (dead).
- **Delete with §3.1:** `ai-legal`, `ai-perf`, `ai-sanity`, `ai-strength`, `onyx-parity`, `onyx-play`, `walt-play`,
  `walt-explain`. That is about 850 lines and about 37 s of the 74 s serial time, plus `tests/fixtures/onyx.onnx` and
  `onyx_golden.json`. CI can then run in parallel again.
- **Server coverage is strong.** Rooms: `rooms`, `rooms-api` (real DO in Miniflare), `rooms-takebacks`,
  `room-votes`, `room-view`, `room-stats`, `room-hand-pause`, `room-player-change`, `family-table`. Accounts, ideas,
  stats, questions and MCP have API tests on real D1.
- **Engine coverage is excellent:** `engine-rules` 802 lines, `invariants` 812 with fast-check, `forced-bidding`, `nello`.
- **Gaps:**
  - The client half of rooms has no unit tests: `useRoom.tsx` (396 lines, a knock state machine, the runner loop,
    dispatch routing) and `RoomConnection` (ack/pending/reconnect).
  - `App.tsx` (all orchestration effects) has no unit tests.
  - `Questions.tsx`, `StatsPage.tsx`, `Account.tsx` and `Ideas.tsx` are covered only by browser scripts.
  - **`scripts/test-rooms-browser.mjs`, `test-ideas-browser.mjs`, `test-ideas-navigation.mjs` and
    `test-account-demo.mjs` are not in `ci.yml`**, so they rot silently.
- **Tests that will fight extraction:**
  1. There is no DOM in tests. `undo-retry.test.ts:239-243` and `:455-461` (`flatten`) and `ui-components.test.ts`
     call components as plain functions and walk the vnodes. That is the whole reason for the "slots can't use hooks"
     rule (`kernel/Slot.tsx:5`, `mods/bidding-hint/index.tsx:4`). Add `preact-render-to-string` or happy-dom and
     rewrite those helpers; the constraint goes away.
  2. `ui-store.test.ts:15` drives whole games through the dead `'ai'` event with an injected `easy` policy. Replace it
     with a test driver that applies `legalActions(g)[0]` (or a seeded pick) via a `computer-action` event.
  3. 21 test files import `src/ui/store` for labels and helpers. Splitting `store.ts` touches all of them; keep
     re-exports for one release.
  4. `mods-partner-badge.test.ts` imports `ui/Table` directly. That's fine, but it will move with the felt.
- **`ci:local`** (`scripts/ci-local.mjs`) runs the `ci.yml` steps serially: node tests, a Python test, vitest, one
  build, and 8 Playwright scripts, each booting Miniflare or a preview server. I did not time it (it builds into
  `dist/`). From the step list I'd expect it to be dominated by the browser scripts. They are independent once the
  build exists; give each its own port and run them with `Promise.all` or `xargs -P`.

---

## 5. Ideas and the builder

- **Size.** About 4,500 lines: worker 568, `src/ideas` 1,154, `scripts/ideas` 706, `preview.yml` + `preview.mjs` 350,
  idea tests about 900, idea browser scripts about 600, docs about 570. That is roughly 15–20% of the repo. Ideas
  also wrote the auth model (family = `idea_members`) and the build-mode flag.
- **Is it pulling its weight?** As a source of *ideas*, yes. This branch's 10 family mods are mostly re-implemented
  idea PRs (PR 62 became birdwatcher, shuffle, congrats and blossoms; PR 79 and PR 88 are named in the coupling
  doc). As a source of *patches*, no: those PRs were cross-cutting diffs to `src/ui` and `src/room` that had to be
  rebuilt to land. I can't see production D1, so I can't count shipped cards. Git shows few merged builder PRs.
- **When the output is a mod folder:**
  - **Scope fence.** Today's "limited" fence is `src/(ui|room|engine)/` and `tests/` (`builder.mjs:38`). That
    includes the engine and the room protocol, the two things a family request should never touch. Replace it with
    `src/mods/<new-id>/**`, one line in `src/mods/index.ts`, and `tests/mods-<id>.test.ts`. That's three paths a
    regex can check exactly. `mod-boundary.test.ts` becomes the reviewer's first gate.
  - **Review.** A diff confined to one new folder, off by default, is quick to review. "Needs a new slot" becomes a
    `blocked` answer that names the slot. Jason adds it to the kernel by hand, which is the only kernel growth path.
  - **Preview vs link-on-prod.** With `defaultOn: false` and `?mods=<id>`, an accepted mod can merge dark and be
    tried on prod by link. That would retire the per-PR preview Worker, `ideas-preview.ts`, `preview-access.ts`,
    `PreviewSignIn`, the HMAC grant, the CORS forwarding, the `local-only` build mode, and the iced/waking lifecycle.
    I'd estimate about 1,000 lines, plus the §3.5-1 token exposure. **But "dark" is not "inert" today.** Every
    mod's module runs at load (`DragHand.tsx` calls `store('drag-arrange')` at top level), and all mod CSS ships in
    the bundle. Before link-on-prod, the kernel should `import()` each mod only when it is enabled (one chunk per
    mod, manifest metadata kept eager). Keep previews for kernel PRs only.

---

## 6. Recommended path

Do these in order. Each step should be a green PR on its own.

1. **Delete the dead weight (S, 1 day).**
   - Remove `src/ai/{easy,medium,hard,evaluate,onyx,onyx-features,harness,table}.ts`, the runtime part of
     `ai/index.ts` (keep the `Difficulty` type until step 3), `ai/walt/{index,explain,worker}.ts` with
     `walt.wasm`, `ui/Review.tsx`, `public/models/onyx.onnx`, the `onnxruntime-web` dependency and alias, the 8
     dead test files and onyx fixtures, the `'ai'` event, `Preset`/`set-preset`, and the `PLUNGE_ROOMS` flag.
   - Park MCP: make `worker/index.ts` main in `wrangler.toml`, remove `mcp*.ts`, its scripts and tests, tag the commit.
   - Also delete `IdeasDemo` and `AccountDemo`, and `NATIVE_TABLE` unless you say the Mac gym still runs through Plunge.
   - Guarded by: the remaining vitest suite, `test-offline-browser`, typecheck. Turn `fileParallelism` back on in CI.
   - Net about −3,500 lines.
2. **Kernel config and cycle breaks (S/M).**
   - Add `src/kernel/config.ts` (`BUILD_ID`, `BUILD_MODE`, `ORIGIN`, `previewFor`). Replace the four hard-coded
     hosts and rename `QUESTIONS_LOCAL_ONLY` to `BUILD_MODE`.
   - Move `rotateGame`/`relativeSeat` to `engine/view.ts`, `HandRetry` to `kernel/table/types.ts`, and `neededYes`
     to `room/votes-shared.ts`.
   - Give the worker `worker/http.ts` for all `json`/`readJson`/`randomHex`.
   - Guarded by: an extended `mod-boundary.test.ts` that also asserts no `src/** → worker/**` edges and no
     `ai → ui` edges.
3. **One turn driver and the player contract (L).**
   - Add `kernel/players.ts` (`ComputerPlayer`) and `kernel/turns.ts`, one async loop with epoch/abort/thinking
     that solo, room runner and practice all call. Walt and Zeb register as players.
   - `native.ts` `api()` splits into `receipts` storage and `player.estimate`.
   - Guarded by: `player-integration`, `zeb`, `native-table`, `auction`, `auction-pool`, `hint`, `undo-retry`,
     `room-player-change`, `test-hand-pause-browser`, `test-offline-browser`, `test:zeb:browser`.
4. **Split `store.ts` (M).**
   - `kernel/table/{reducer,rollback,persist}.ts`; seat names as data, not a module `let`; copy strings moved to UI.
   - Unify undo by making `room-undo.ts` call the same `rollback(game, humanIndices)`.
   - Also stop recording history inside the reducer (one recorder effect), and stage a snapshot, not the whole
     AppState.
   - Guarded by: `ui-store`, `undo-retry` (after the render-to-string switch), `rooms-takebacks`, `history*`.
5. **Test harness swap (S).**
   - Add `preact-render-to-string` (dev). Rewrite the `flatten`/`buttons` helpers. Drop the no-hooks rule from slots.
   - Add `test-rooms-browser` and the ideas browser scripts to CI, or delete them.
6. **Redact at shared tables (M).**
   - First, cheap: the kernel hands mods a `game` with other seats' hands emptied when `app.room` is set.
   - Then on the server: per-socket `RoomState` with own hand, the runner's Walt seats, and a full reveal at hand-over.
   - Guarded by: `rooms-api`, `family-table`, the browser room scripts.
7. **Routes, screens and home entries (M).**
   - `kernel/routes.ts`: one table of search/hash params, each owned by a module.
   - New slots: `screen:<id>`, `home.entry`, `more.section`, `menu-item`, `hand-heading`, `trick-tap`,
     `handover-footer`. `main.tsx` becomes "find the route, render its screen".
8. **Lazy mods (S/M).** Load each mod with `import()` only when it is enabled. Guarded by `mods.test.ts` and an
   offline-browser assertion that a disabled mod's chunk is never fetched.
9. **Extract the built-ins, in this order:** `move-hint` → `question-notebook` → `review` (NativeReview,
   NativeStats, share/observation links) → `solo-history` → `stats` → `family-table` UI (from `useRoom`) →
   `account` page → `ideas` (board plus long-press). Each one is M, about 2–3 days, and each is guarded by its own
   existing tests plus one browser script. After this, `Table.tsx` should be under 250 lines and `App.tsx` under 120.
10. **Kernel storage (M).**
    - `kernel/storage.ts`: namespaced localStorage and IndexedDB per module, plus a registry. `exportHistory` becomes
      "export every registered store".
    - Leave old DB names in place, registered as-is. No data migration.
11. **Auth owns family (M).** Add `accounts.family` (or `family_members`) and migrate the
    `idea_members.revoked=0` semantics. Ideas then joins accounts, not the other way round. Guarded by
    `accounts-api`, `ideas-approvals`, `stats-browse-api`, `family-table`.
12. **Builder emits mod folders (S once 7–8 land).** New fence, `blocked: needs slot X`, merge-dark plus a
    `?mods=` link, and keep previews only for kernel PRs. Fix the preview job split (§3.5-1) in the same PR
    *or earlier*.

**End state.** The kernel is engine, table session (reducer, rollback, turns), player contract, room comms, auth,
storage, config, routes and the mod loader: roughly 5–6k lines. Everything a person sees beyond the felt and the
bid/trump controls is a mod.

---

## 7. Ten things I'd fix this week (regardless of mods)

1. **Preview job token exposure.** `.github/workflows/preview.yml:101-131`: PR `tests/` run before
   `npx wrangler deploy` from PR `node_modules` with `CLOUDFLARE_API_TOKEN`. Split build and deploy jobs (§3.5-1).
2. **Delete `src/ui/Review.tsx:1` and the onyx model.** Review is dead (284 lines). `public/models/onyx.onnx`
   (1.2 MB) is deployed for nothing. Drop `onnxruntime-web` from `package.json`.
3. **Make `worker/index.ts` the Worker main.** `wrangler.toml:5` routes every request through the parked MCP/OAuth
   entry (`worker/mcp-entry.ts`).
4. **Stop validating the 572 KB bid book at Worker cold start.** `src/ai/bid-book.ts:46` reaches the worker via
   `worker/rooms.ts:9`. Give rooms just a seeds list, or validate lazily.
5. **History write amplification.** `src/ui/App.tsx:45-50` records inside the reducer and `:65-72` records again.
   `src/history/recorder.ts:73-77` writes the full AppState JSON to localStorage on each call.
6. **Value import cycle.** `src/ui/store.ts:39` ↔ `src/room/view.ts:4`. Move `rotateGame`/`relativeSeat` to engine.
7. **Long press vs. drag-arrange.** `src/ideas/QuickIdea.tsx:42` (600 ms hold on any element in capture phase)
   opens the idea composer when someone holds a domino before dragging in the `drag-arrange` mod. Give the kernel a
   "this element owns long-press" attribute the mod API can set, as QuickIdea already does for `[data-idea-tools]`.
8. **Practice opponents are always Zeb.** `src/stats/practice-computer.ts:15-16`. Use the hand's recorded model, or
   label it in the UI ("practice is against Zeb"). It may be deliberate, because Walt's book only covers catalogue
   deals, but nothing says so.
9. **Duplicate family-table entry code.** `src/ui/Home.tsx:57-68` and `:130-144` have the same `openFamilyTable`,
   and both components poll `/api/rooms/live`. Extract one hook. This also halves the home screen's polling.
10. **Rotting CI coverage and stale docs.**
    - `.github/workflows/ci.yml` omits `scripts/test-rooms-browser.mjs` (the only three-phone real-player room
      check) and the ideas navigation and browser checks.
    - `deploy.yml` re-runs the full suite instead of depending on CI.
    - `src/env.d.ts:5` and `README.md` (the "Advanced settings… L1" paragraph) are stale.

Honorable mentions:
- Rate-limit `POST /api/rooms` (`worker/rooms.ts:717`).
- Make `/api/rooms/live` (`worker/index.ts:42`) signed-in-only, or strip names from it.
- Use separate secrets for preview HMAC and admin (`worker/ideas-preview.ts:56`).
- Move the seat token out of the socket URL (`src/room/client.ts:100`).
- Add a guard against new duplicate migration numbers (`migrations/0004_*`, `0005_*`).
