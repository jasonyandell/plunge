# The played-game bidder

New Walt matches use the 130 catalogue deals (520 bidder hands) in the completed
Kiln actual-play campaign. Each match shuffles their order deterministically from
its seed; no deal repeats within its first 130 hands. The ordinary shaker rotation,
marks, bidding cadence, human bidding and move-by-move Walt play remain intact.

At auction time, a lookup receives only the acting player's seven dominoes and
seat. Public bids supply the legal raises; the real opposing hands and catalogue
seed do not enter scoring. Each of nine declarations has complete-game score tails
for targets 30 through 42. Walt takes the highest legal target achieved in at least
4/5 of recorded games, chooses the strongest declaration for that target, and
passes over a partner's standing bid. A forced 30 uses the best available panel
without pretending it cleared the cutoff. If 42 qualifies, use the cheapest legal
plain-marks bid rather than inventing an appetite for larger stakes.

The frozen book contains **318,472 games, 4,680 panels, 520 hands and 130 deals**.
All 318,472 receipt hashes and 8,917,216 moves passed the independent auditor.
The five added deals are seeds **420725–420729**; all 305,440 previous receipt
hashes and all 500 previous compact hand records are unchanged. The new deals
contribute 13,032 games. Sample depths are 8 (1,629 panels), 40 (2,284),
160 (564), 320 (19), and 640 (184). There are 79 capped-unsettled panels,
including four new ones. Uncertainty is retained rather than altering the cutoff.
The full catalogue includes weak hands.
The last bidder still takes at least 30 after three passes.

Each match independently shuffles the catalogue. A larger pool adds variety;
it does not prevent two separate matches from drawing the same deal.

## Evidence and limits

Book identity: `bfa96d130ad3a39066c75733aa61a4aad2bf8c7c679421f4c00b651a9db40dc1`.
Measured policy: `walt-table-v2-opening160-ordinary40-partner-bid30-v1`.
Source export: `played-book-520-final.json` from a consistent copy of the completed
500-hand campaign, extended with the frozen producer
`6ea576a9436d3da8aa3dd10628a3137f16bd056872f673ebe91691272974158c`
at research commit `40be1356043665c47d1e20a1a81066240039d733`.
This book is the empirical actual-play export, not the earlier scalar-model survey.

These are score frequencies under bid-30 play. They are a practical bidding
heuristic, not calibrated guarantees for higher-target play, humans, the optional
L1-only setting or the particular other hands in a catalogue deal. Screening and
adaptive allocation also prevent interpreting 80% as a certified reliability bound.
Each stored auction records its distinct empirical schema, source book, source
profile, selected target, declaration, sample counts and allocation uncertainty.
Auction hints use this same book without changing the playing policy.

Fresh games and each next hand use the catalogue. A saved old hand finishes as
it stood; if its hand is not in the book, its auction retains the existing live
calculation. Shared hand links keep their original exact deals. Start a new match,
or finish the current hand, to get the quick book auction.

## Updating the book

1. Use Python 3.12 to export and independently audit a consistent completed campaign
   snapshot with the research `experiments/kiln/played.py` utilities.
2. Preserve the export and audit outside both worktrees. Keep earlier releases.
3. Run `python3.12 scripts/import-bid-book.py PATH/played-book-520-final.json src/ai/book/played.json`.
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

## Human bidding hints

The optional auction hints reuse `bookAuction` and the player's shared
`partnerAuctionPass` rule. They never dispatch actions or run a solver. Trump
hints price the actual won contract, even if the human bid exceeds the book's
usual cutoff. Targets 30–42 are inspectable without altering the recommendation
or making an illegal bid. The UI reports raw achieved counts and sample sizes,
labels unresolved threshold estimates, and explains the bid-30 measurement
boundary. Missing old hands and unsupported contracts/rules get no fabricated
empirical recommendation. No new cache or saved-match format is needed.
