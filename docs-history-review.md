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

All hands are only shown behind **Show all hands (hindsight)**, labelled
"nobody at the table could see all of these". The comparison sentence says
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

Controls in a hand: tap the recorded move (outlined) or **Next ›** to replay;
tap any other legal move to branch; keep choosing moves for whoever is next;
**‹ Undo** removes the last branch move; **Back to what happened** drops the
branch; timeline chips jump to any decision; **‹ Hands** or system back returns
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
