# Talk over past hands — review prototype

A phone-first way for the family to go back over a hand between games:
replay up to a move, branch with "what if I had played X?", and compare what
hindsight says with what the player could have known at the time.

## Two answers, never mixed

| Card | What it is | What it is not |
| --- | --- | --- |
| **What actually happened** | The recorded hand, played by the real players. | — |
| **Hindsight: the real hands, one finish** | From the decision on, the practice player (`src/ai/medium.ts`, not Walt) plays all four seats **once** on the real deal: after the recorded move, and after your branch. A realized outcome of one continuation. | Proof that a move is better, or best. |
| **What you knew: an estimate** | The deciding seat's own hand plus public bids and plays (`observe`), hidden hands guessed 24 times (`sampleWorld`), every legal option finished on the same guesses. Ahead/behind counts and average net marks. | Certain. Bid inferences are ignored, and the practice player is a simple stand-in. |

## On the game's own table

A hand replays on the same table as live play: the status strip, trump and
suit-led cards, trick history, felt, seats and tiles all come from
`src/ui/TableFelt.tsx`, which the live `Table.tsx` also renders (its markup is
unchanged). `src/ui/ReplayTable.tsx` puts a detached, read-only position on
that felt; it never sees the app store or the game in progress.

- Seats never move: you at the bottom, Earl left, Gran across, Ruby right.
- The hand area shows **whoever acts at this point**, labelled by name
  ("Earl to play · Earl's hand (left seat)"), and only that seat's tiles are
  face up. When someone else acts, your own tiles stay face down in a row at
  the bottom.
- Only legal tiles (or bid/trump chips) are bright and tappable. The recorded
  move is outlined and tagged **actual**; tapping it replays, tapping anything
  else branches.
- A ribbon on top says which hand and move you are on; on a branch it turns
  amber: **What if… Not what happened**. Controls: **‹ Back/Undo**,
  **Next ›** or **↩ Actual**, and **Talk it over ▴**, a sheet with the
  discussion prompt, the three answers below, and every decision as a timeline.
- **Show all hands on the table (hindsight)** sits in the hindsight card of
  that sheet. When on, every hand is face up under a dashed outline and a
  banner, "Hindsight: all hands face up. Nobody at the table could see these.",
  with **Hide** right there.

## From inside a game

**Replay past hands ›** appears at the foot of the open trick history and on
the hand-over and game-over cards (never for a shared hand), so there is no need
to go Home. Review opens over the table, and the exit reads **Back to game**.
While it is open, nothing at the table advances: no AI move, and a finished
trick on show stays on show. The game, its save, Walt receipts and the trick
history panel are left exactly as they were. **The hand still being played is
listed but closed** ("Being played now — finish it to review"), from Home too,
because replaying it would show other seats' tiles mid-game. It opens once the
hand ends.

All hands are only shown behind **Show all hands on the table (hindsight)**, labelled
"nobody at the table could see these". The comparison sentence says
"too close to call" when the paired difference is within about two standard
errors, and otherwise always adds "That is an estimate, not a proof."
A test swaps two hidden hands and requires the estimate to stay identical, so
the estimate cannot depend on hidden information.

## Where hands come from (read-only)

`src/review/library.ts` merges, without writing:

- `plunge-history` events (PR16 snapshots; growing snapshots of one hand collapse to the longest line),
- `plunge-stats` finished hands (`plunge-hand-v1`),
- `plunge-records` hand-v2 records from the in-flight records branch, **only if
  that database already exists** (opening it would otherwise create an empty
  v1 database and break that schema's own upgrade); displayed-hint markers are
  shown on the timeline,
- staged localStorage writes (`plunge:history:pending:*`), left in place for the recorder.

Records this build cannot read are counted ("kept untouched and included in
Export history"). A store that fails to open is named, with **Try again** and
**Export history**; the other stores still show.

## Local navigation and QA routes

Everything lives in the location hash, so reload and the phone's back gesture work:

| Route | Shows |
| --- | --- |
| `#review` | Hand list (example hands appear when there is no history, or via **Show example hands**). |
| `#review=example-you-bid%3A1` | Example: you bid 30 in aces and made it on a lucky partner hand — a good hindsight-vs-knowledge case at trick 2 (`&at=9`). |
| `#review=example-you-defend%3A1` | Example: you defended and set the contract. |
| `#review=example-unfinished%3A1` | Example: the record stops partway through the hand. |
| `#review=example-you-bid%3A1&at=9&b=p61` | Trick 2 with your branch 6-1 already played (reload-safe). |
| `#review&qa=storage-failure` | Every store refuses to open: failure copy, Try again, Export history, examples still usable. |
| `#review=nope%3A1` | A hand that is not on this device. |

Controls in a hand: tap the recorded move (outlined, **actual**) or **Next ›** to replay;
tap any other legal move to branch; keep choosing moves for whoever is next;
**‹ Undo** removes the last branch move; **↩ Actual** drops the
branch; timeline chips (in **Talk it over**) jump to any decision; **‹ Hands** or system back returns
to the list. Examples are generated in memory by the practice player and never
saved.

Review makes no network requests, so it behaves the same in a database-free PR
preview ([preview guide](docs-previews.md)). There it reads that preview origin's
own browser history; production history on the same phone is a separate origin.

## Limits

- The practice player is a deterministic heuristic, not Walt; Walt hints and
  receipts are not re-run here.
- Estimates use 24 guesses and ignore what bids implied; small differences are noise.
- Estimates are cached only for the open page.
- No notes, timed puzzles, uploads or stats dashboard in this prototype.
- At 320×568 with hindsight on, the side seats' names are partly covered by
  their face-up tiles; the live table already crowds its side seats at that size.
- A finished trick's gather animation keeps running under the review overlay,
  so on return it may already look gathered for the rest of the pause.
