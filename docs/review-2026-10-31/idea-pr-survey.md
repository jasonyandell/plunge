# PR survey for mod slots (diffs vs merge-base with origin/main)

Legend: scope = DEVICE (only viewer) / TABLE (shared room). Kind = presentation / rules / AI.

## PR 77 - drag to arrange dominoes (codex/idea-e4d730...)
- Does: viewer can drag (or Alt+arrows / Arrange buttons) to reorder own hand; personal display order only.
- Core touched: NEW src/ui/Hand.tsx (179 lines, self-contained). src/ui/Table.tsx hand-area: replaces the inline `<div class="hand">{humanHand.map(<Domino interactive onTap>)}` with `<Hand key=... hand legal humanTurn showHints onPlay>`; the play logic (legal check -> setPlayError, dispatch human play) moves into an onPlay callback. Scenario branch keeps a plain hand. table.css: `.hand > .dom` selector widened + .hand-tile/ghost/arrange styles.
- Reads: humanHand (g.dealt[HUMAN_SEAT]), legal set, humanTurn, settings.showHints, sessionId+handNumber (reset key).
- Presentation only; never reorders engine hands or sends room actions. DEVICE.
- Slot: a REPLACEABLE hand renderer: `hand.render` (wrapper that receives {hand, legal, humanTurn, showHints, onPlay} and returns the hand UI; default = core plain hand). Needs core to own the onPlay callback.

## PR 81 - flash "let them in" button (codex/idea-e71f53...)
- Does: the Yes button on a door/join vote (.vote-door) pulses butterscotch twice (respects reduced-motion).
- Core touched: CSS ONLY, src/room/room.css (`.vote-door .vote-yes:not(:disabled)` + @keyframes). No TSX.
- Reads: nothing new; relies on core already emitting class `vote-<mode>` ("vote-door") on VoteBar.
- Presentation. DEVICE (each viewer sees their own button flash).
- Slot: `styles` (mod-contributed CSS) + stable class/data attrs on VoteBar (already has `data-kind`, `vote-${mode}`). No component hook needed.

## PR 82 - partner badge (codex/idea-d0366e...)
- Does: restyles the partner seat label so "Your partner" is a prominent pill (name bold + label).
- Core touched: src/ui/Table.tsx `OpponentTop` .seat-name: wraps name + `<span class="seat-tag">Your partner</span>` into `<span class="partner-identity"><strong>name</strong><span class="partner-label">Your partner</span></span>`. table.css: .partner-identity (shares .you-label pill rule), .partner-label.
- Reads: seat name only (top seat is always partner of viewer in this layout).
- Presentation. DEVICE.
- Slot: either CSS-only (needs stable class on partner tag; markup change is tiny) or `seat.label` slot: {seat, relation:'partner'|'opponent'|'self', name} -> node, replacing/augmenting the name+tag. Minimal: core renders `<span class="seat-tag seat-tag-partner">`, mod styles it.

## PR 83 - make Walt/Zeb switch vote noticeable (codex/idea-6b55b9...)
- Does: for `proposal.kind==='player'` (computer-player change vote) VoteBar gets a "Computer player vote" heading, big amber card styling, and "Waiting for the table" after you vote yes.
- Core touched: src/room/VoteBar.tsx (3 spots: heading span inside .vote-text; `.vote-you` text suffix); room.css (`.vote-bar[data-kind="player"]` block).
- Reads: proposal.kind, proposal.endsGame, proposal.mode, my vote (`mine`), existing data-kind attr.
- Presentation. DEVICE (the vote itself is table-wide, but each viewer's rendering is local).
- Slot: CSS via data-kind (already there) + VoteBar content slots: `vote.heading` and `vote.status` (props: {proposal, seat, mine, yes, needed}) - or a single `vote.render` override.

## PR 85 - see other hands while sitting out Nel-O (codex/idea-1be1290...)
- Does: when the viewer (HUMAN_SEAT) is g.sittingOut in Nel-O, the three other hands render face-up; note text appended.
- Core touched: src/ui/Table.tsx `OpponentTop` and `OpponentSide` mini hands: `<Domino id={g.sittingOut===HUMAN_SEAT ? id : undefined} faceDown={g.sittingOut!==HUMAN_SEAT}>`; sit-note text in the own-hand sit-out block. tests/nello-hand-visibility.test.ts.
- Reads: g.sittingOut, HUMAN_SEAT, each seat's hand (hand data must already be in client state: true solo; in rooms hands for other seats may not be sent to this client - CHECK; PR uses HUMAN_SEAT so it only works as written for local seat 0).
- Presentation of already-present info; no rule change. DEVICE (only the sitting-out viewer). Info-leak caveat: in a room, a sitting-out player seeing hands is fine only if that player cannot relay (voice chat) - policy, not code.
- Slot: `opponent.hand.faceDown` predicate/filter: ({g, viewerSeat, seat}) -> boolean (reveal). Plus `seat.note` for the sit-out text (existing seatNote prop mostly covers it).

## PR 50 - red background (codex/idea-9ade69e...)
- Does: body background colors/gradient changed wood -> red.
- Core touched: CSS ONLY, src/ui/app.css `body` background-color + linear-gradient (4 lines).
- Presentation. DEVICE.
- Slot: theme/CSS tokens (`styles` slot, ideally body background via CSS vars e.g. --bg-base/--bg-grad that mod overrides). Needs core to expose the vars; today it is hardcoded literals.

## PR 62 - Scifigoofy's playground (codex/scifigoofy-showcase), 23 files, 852 lines
Bundle of 5 independent pieces + a showcase/tour harness:
1. Cherry blossoms: table.css `.felt` gets two background-image SVGs (src/ui/cherry-blossoms.svg) at top corners; forced-colors off. CSS only. DEVICE.
2. Chibi mascot + shuffle animation: NEW Shuffle.tsx exports `useDealFlourish(app)` (watches app.game.handNumber/sessionId, phase==='bidding', screen==='table', !scenarioGame, !retry; 2.8s timer) and `<Shuffle/>` (SVG tandem-bike couple + tiles). Core: App.tsx calls hook and passes `shuffling` prop to BOTH `<Table>` usages; Table.tsx renders `{shuffling && !scenario && <Shuffle key=.../>}` above the InfoBar. Presentation, never blocks deal. DEVICE.
3. Congrats image: NEW VictoryPicture.tsx (SVG, prop `won`). Core: sheets.tsx GameOverSheet card gets `game-over-card` class + `<VictoryPicture won/>` at top; sheets.css scroll/size rules. DEVICE. Also `?preview=congrats` route in App.tsx.
4. Birdwatcher during long pauses: NEW Birdwatch.tsx (timer 20s, resets on visibilitychange; renders bird + watcher SVG). Core: Table.tsx wraps `<OpponentTop>` in `<div class="birdwatch-perch">` and renders `<Birdwatch key={sessionId:epoch:handNumber:tricks:currentTrick:turn:dominoPicks} delayMs>` when phase==='playing' && !showingLast && !review && !menuOpen && !histOpen && !question && !confirmRestart && !room proposal; adds `birdwatch-table` class on .table-screen in playing phase; adds `dominoPicks` state incremented in the human hand onTap (to reset timer on a tap even if illegal). Reads: phase, hand number, trick count, currentTrick length, turn, UI-open flags (menu/history/question/restart-confirm), room proposal, document visibility. Resets on ANY state change. DEVICE.
5. Showcase/tour harness (ScifigoofyShowcase, BramConcept, scifigoofy-tour, showcase-notes, birdwatch-demo, `?demo=1&step=` routes in App.tsx, Table props `birdwatchDemo`, `birdwatchEnabled`, `demo`, StatusStrip `hideMenu`; ~15 `&& !demo` guards in Table): a disposable-table demo mode that disables questions, hints, menu, review. NOT a mod; it is a dev/preview shell. Also docs/VISUAL-PLAYGROUND.md.
- All presentation, no rules/AI. DEVICE.
- Slots: `table.decor` (overlay layer inside Table; props: {g, app, ui:{menuOpen,histOpen,question,confirmRestart,review,showingLast}, interactionTick}) for Birdwatch & Shuffle; `table.seat.top.wrap` or decor anchored to partner seat for the perch; `felt.background` / styles for blossoms; `gameover.header` (props {won, g}) for victory picture; `events` bus: `deal`(handNumber, phase) and `humanTap` so mods need not patch core with dominoPicks/useDealFlourish; `routes`/`screen` for demo routes (or drop the showcase harness).
- Can't be a mod as-is: the showcase harness (item 5, App-level route takeover + `demo` flags in Table). Also App.tsx currently calls the hook (hooks must run unconditionally in core) -> mods need a `useMod` host that mounts per-mod components so hooks live inside the mod's component.

## PR 79 - computer players bid cheapest winning bid when last to speak (codex/idea-69d52a...)
- Does: when bids.length===3 (last to speak), a one-mark/points bid is lowered to the cheapest legal one-mark bid (nobody left to outbid); marks>1 and specials unchanged. Humans still may overbid ("computer players and hints take cheapest").
- Core touched: NEW src/ai/last-bid.ts `cheapestLastBid(g, action)` (uses legalActions). src/ai/book-auction.ts `bookAuction`: after choosing action, `action=cheapestLastBid(g,action)` and re-derives bid/panel (for hints/explanations). src/ai/zeb/index.ts `zebAuctionAction`: `return cheapestLastBid(g, action)`. Tests: bid-book, bidding-hint (2 lines), zeb.
- Reads: g.phase, g.bids.length, action, legalActions(g).
- AI behavior (changes bids by Walt/Zeb and bidding hints; engine rules untouched). Effect is TABLE-wide for game outcome (bots bid differently) and must be identical for everyone/replays -> deterministic, version it. NOT per-viewer.
- Slot: AI post-processor `ai.bid.adjust(g, action, ctx:{player:'walt'|'zeb'|'hint'}) -> Action` called by every auction chooser (book-auction, zeb, hint path). Must be applied to all three call sites uniformly. Because it changes game outcomes in shared rooms and AI records/receipts (digest in zeb), it must be a room-level setting (everyone agrees) not a device toggle.

## PR 88 - challenge hands (codex/idea-1af113...)
- Does: standalone practice screen with 3 fixed "there is a winning way" deals (bid 42, sixes trump), medium-AI replies, undo/hint/restart; own reducer; never touches saved match.
- Core touched: App.tsx (import + `case 'challenges':` in screen switch -> `<Challenges onBack>`); Home.tsx (one button `dispatch({type:'go',screen:'challenges'})` under resume/new-game buttons); store.ts `Screen` union gets 'challenges'. All else NEW: Challenges.tsx, challenge-hands.ts (uses engine newDealtGame/applyAction, ai/medium, ai/observation), challenges.css, tests.
- Reads: nothing from app state; engine + medium AI only. Own useReducer.
- New content/screen, no rule/AI change. DEVICE (solo only; irrelevant in rooms).
- Slots: `home.entry` (button/link list on Home; props {go(screenId)}), `screens` registry (id -> component {onBack}); Screen type must become open (string) or mod ids. Cleanest mod of the set.

---
# Consolidated slot list (deduplicated)

| # | Slot | Where / what it hooks | Props | Used by |
|---|------|----------------------|-------|---------|
| 1 | `styles` (+ theme CSS vars) | mod stylesheet loaded when enabled; core exposes vars for body bg and felt bg and stable class names | - | 50, 81, 82, 83, 62 (blossoms) |
| 2 | `home.entry` | extra button/link list on Home | {go(screenId)} | 88 |
| 3 | `screens` | route registry; mod provides component for `app.screen===mod:<id>` (Screen type opened up) | {onBack} | 88 (62 demo harness) |
| 4 | `hand.render` | replaces the human hand renderer in Table (default = plain tappable dominoes) | {hand, legal, humanTurn, showHints, onPlay} | 77 |
| 5 | `table.decor` | overlay layer inside .table-screen / .felt; mod components mounted (hooks live in mod) | {g, app, ui flags (menuOpen, histOpen, question, confirmRestart, review, showingLast), room proposal present} | 62 (Birdwatch, Shuffle) |
| 6 | `table.partnerPerch` (or decor anchored to a seat) | wrapper/anchor at the top-seat for birdwatch positioning | {seat} | 62 |
| 7 | `events` bus | `deal` {sessionId, handNumber, phase}, `humanTap`/`humanPlayAttempt`, `trickChange`, `phaseChange`, `visibility` | event payloads | 62 (shuffle trigger, birdwatch reset) |
| 8 | `seat.label` | contents of .seat-name for a seat, with relation | {seat, name, relation:'partner'|'opp'|'self', g} | 82 |
| 9 | `seat.hand.reveal` | predicate: render a seat's mini-hand face-up | {g, viewerSeat, seat} -> bool | 85 |
| 10 | `seat.note` / sit-out note | text under own sat-out hand (existing seatNote covers other uses) | {g, viewerSeat} -> string | 85 |
| 11 | `vote.heading` / `vote.status` (or `vote.render`) | VoteBar internals | {proposal, seat, mine, yes, needed} | 83 (81 uses CSS only) |
| 12 | `gameover.header` | top of GameOverSheet card | {g, won} | 62 (congrats image) |
| 13 | `ai.bid.adjust` | post-processor on every computer/hint auction choice (book-auction, zeb, hint) | (g, action, {player}) -> Action | 79 |

Notes / not-a-mod flags
- 79 changes game outcomes (bots) and AI receipts: needs room-wide agreement + determinism/versioning; a per-device toggle would desync hints vs bots and replays. Ship as a room setting, not a device setting. Also: it is AI code in src/ai, so slot 13 is a different kind (logic hook, not UI).
- 62 showcase/tour harness (`?demo`, `?step`, `?preview`, `demo` flags in Table, hideMenu) is app-level routing and a dev shell: not a mod; drop or keep as separate entry. Also PR 62 bundles 5 ideas: split into 4 mods (blossoms, shuffle, congrats, birdwatch).
- 85: hand visibility depends on what hands the client holds; verify rooms send other seats' hands to a sitting-out client; it also hardcodes HUMAN_SEAT (should be room localSeat).
- 77: Table currently owns the legality error message (setPlayError) and dispatch; slot 4 must pass an onPlay that does both, else mod must reimplement.
- 62 Birdwatch: needs the host to remount it on any state change (key) - slot 5 should re-key decor per play, or slot 7 events.
- 81, 82, 50, 83(partly) need only stable class/data attributes plus mod CSS; the only core change is exposing hooks like `data-kind`, `vote-<mode>`, `seat-tag-partner`, and CSS variables for body/felt backgrounds.
- Scope summary: DEVICE (presentation) = 77, 81, 82, 83, 85, 50, 62, 88. TABLE-affecting = 79 only (and 83's vote is a table-wide proposal but its styling is device-local).
