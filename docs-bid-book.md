# The played-game bidder

New Walt matches use the 125 catalogue deals (500 bidder hands) in the completed
Kiln actual-play campaign. Each match shuffles their order deterministically from
its seed; no deal repeats within its first 125 hands. The ordinary shaker rotation,
marks, bidding cadence, human bidding and move-by-move Walt play remain intact.

At auction time, a lookup receives only the acting player's seven dominoes and
seat. Public bids supply the legal raises; the real opposing hands and catalogue
seed do not enter scoring. Each of nine declarations has complete-game score tails
for targets 30 through 42. Walt takes the highest legal target achieved in at least
4/5 of recorded games, chooses the strongest declaration for that target, and
passes over a partner's standing bid. A forced 30 uses the best available panel
without pretending it cleared the cutoff. If 42 qualifies, use the cheapest legal
plain-marks bid rather than inventing an appetite for larger stakes.

The frozen book contains **305,440 games, 4,500 panels, 500 hands and 125 deals**.
All 305,440 receipt hashes and 8,552,320 moves passed the independent auditor;
every original 42,008-game receipt is unchanged. Sampling depths are 8 (1,575
panels), 40 (2,189), 160 (541), 320 (19), and 640 (176). There are 75 capped-unsettled
panels. The empirical rule qualifies 80 declaration panels belonging to 61 hands
across 52 deals. The full catalogue is dealt, including weak hands and ordinary
all-pass reshakes. We have not changed the risk cutoff to manufacture more bids.

## Evidence and limits

Book identity: `77cb49c7a8d7f8b4548cf982d97f424d062ed1a88f9091bbb0ba0484528f2bc2`.
Measured policy: `walt-table-v2-opening160-ordinary40-partner-bid30-v1`.
Source export: `/Users/jason/data/texas-42/kiln-played-v1/played-book-500-final.json`.
This book is the empirical actual-play export, not the earlier scalar-model survey.

These are score frequencies under bid-30 play. They are a practical bidding
heuristic, not calibrated guarantees for higher-target play, humans, the optional
L1-only setting or the particular other hands in a catalogue deal. Screening and
adaptive allocation also prevent interpreting 80% as a certified reliability bound.
Each stored auction records its distinct empirical schema, source book, source
profile, selected target, declaration, sample counts and allocation uncertainty.
The phone's playing WASM is unchanged.

Fresh games and each next hand use the catalogue. A saved old hand finishes as
it stood; if its hand is not in the book, its auction retains the existing live
calculation. Shared hand links keep their original exact deals. Start a new match,
or finish the current hand, to get the quick book auction.

## Updating the book

1. Use Python 3.12 to export and independently audit a consistent completed campaign
   snapshot with the research `experiments/kiln/played.py` utilities.
2. Preserve the export and audit outside both worktrees. Keep earlier releases.
3. Run `python3.12 scripts/import-bid-book.py PATH/played-book-500-final.json src/ai/book/played.json`.
   The importer checks the source identity, histogram/tail equality, original bid
   recommendations, completed catalogue and policy. It does not query production.
4. Run the tests and build. `tests/bid-book.test.ts` compares all catalogue hands
   to the real engine's numeric-seed shuffles and every hand's bid to its tails.
5. Deploy through the existing GitHub Actions workflow. The book is part of the
   hashed application asset, so it works offline and updates with the game.

The original game engine, live-auction fallback and all replay mechanics remain
available. Book-backed seats are excluded from speculative auction work; they do
not start bidding workers. An entire normal auction keeps only the existing short
presentation pauses, with no declaration solver work on the device.
