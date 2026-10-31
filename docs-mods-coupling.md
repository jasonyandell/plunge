# Mods: what is still coupled (scratch notes, 2026-10-30)

## Where extracting the bidding hint hurt

- **The substance could not move.** Walt's book panel (`BookDetails`) is also how a saved
  question replays the hint (`src/ui/SavedHint.tsx`), and core may not import a mod. It moved to
  `src/ui/BookDetails.tsx` and is reached through `src/kernel/advice.ts`. Zeb's `ForecastDetails`
  is in the same spot. So the mod is the button, the dialog, and Zeb's loading/retry; the advice
  text and tables are core. Honest size: ~60 lines of mod, ~190 of core it leans on.
- **advice.ts breaks the two-mods rule a little.** Four exports (`waltAuctionAdvice`,
  `zebAuctionAdvice`, `BookDetails`, `ForecastDetails`) have one mod as user. They are there
  because core needs them too (saved questions), not because a second mod does.
- **hint.css stays in core.** `.bid-hint-button` is the mod's, but `.hint-dialog`, `.bid-hint-*`
  are shared with MoveHint, BookDetails and ForecastDetails. Moving it would need scoping under
  `data-mods` and break saved-question pages with the mod off.
- **Slots cannot use hooks.** `tests/undo-retry.test.ts` calls `DeclareSheet`/`GameOverSheet` as
  plain functions and walks into every function component. `Slot` therefore reads `modState()`
  directly and `App` calls `useMods()` to re-render. The same walk reaches a mod's slot component:
  a **default-on** mod filling `declare-sheet` or `gameover-header` must keep hooks out of its
  top-level component (bidding-hint's `Hint` wrapper returns `null` or `<BiddingHint/>`).
  Family mods are off in tests, so they are unaffected.
- **Two seat ideas.** Zeb's advice uses seat 0 of the rotated game; Walt's book uses the unrotated
  `bookSeat`. Both are in `AuctionSlotProps`; a mod author has to read the comment.

## What the brief assumed that is not so

- "In rooms the server hides other hands": it does not. `RoomState` is a trusted family prototype
  and sends all four hands to every member (`src/room/protocol.ts`). The kernel refuses
  `seat-reveal` at any shared table, but every slot still gets the full `game`. The real fence is
  server-side redaction, or the kernel handing mods a `game` with other seats' hands emptied at
  shared tables. Not done: it changes what `table-above-hand` sees and wants its own decision.

## Still coupled in core

- **Table.tsx**: MoveHint gating (`isNative`, `explainScope`, the position key); question
  selection and the save toast; undo/replay resting and confirm; end cards with practice and
  model summary; GameMenu with `HintsSwitch`; the play-error message (now shared with the `hand`
  slot through `onPlay`). Seat rendering (`OpponentTop/Side`) is shared with `stats/ReplayPane`,
  so seat slots also appear in replays.
- **store.ts**: `SEAT_NAMES` is a module `let` swapped by rooms (`setSeatNames`); mods only get a
  name through `seat-label`. `showHints` lives in `Settings` and is saved by `saveShowHints`; the
  copy helpers `handOverCopy`/`gameOverCopy`/`thinkingCopy` still live here.
- **sheets.tsx**: bid and trump controls, special-bid hints, and "no hints across the table" for a
  partner's plunge are core. End cards are core apart from `gameover-header`.
- **ModsSettings** says "Extras for the table": a default-on built-in now sits beside family mods
  in one list; if more built-ins arrive, group them.

## Not built (on purpose)

- `home.entry` / `screens` (PR 88 challenges): needs `Screen` opened to strings. Next when a mod needs it.
- An event bus: decor gets `ui` flags and `game`; mods derive deals/tricks themselves.
- An interaction tick for "the player tapped" (PR 62 birdwatch resets on illegal taps). A `hand`
  replacement sees taps; decor does not. Add a counter to `TableUi` when birdwatch is built.
- `ai.bid.adjust` (PR 79): changes the game for everyone; needs a table scope and room agreement,
  not a device switch.
- A dispatch for auction slots: no mod needs to bid for you yet.

## MoveHint: left in core

Not cheap. It needs a new slot in the hand heading, the native solver (`requestTile`, worlds,
abort), `ai/hint`, `MoveScores`, `SaveHint`, and Table's gating and keying. Exporting the native
worker through mod-api is a wide, one-user surface. Do it with a `hand-heading` slot and a
`moveAdvice(g, player, worlds, signal)` in advice.ts; then advice.ts has two users.

## Recommended next

1. Redact other hands from mod props at shared tables (kernel), then relax `seat-reveal` only if
   the room agrees.
2. MoveHint as built-in, per above.
3. `home.entry` + `screens` for challenge hands; the cleanest family mod in the survey.
4. Theme mods (red, blossoms) and the partner badge: CSS only now, good first parallel tasks.
