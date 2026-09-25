# Human-called Nel-O — Preview

Enable **Nel-O · Preview** in **Advanced settings** (off by default), then bid one mark or a legal higher mark bid, then choose **Nel-O** when declaring.
Your partner sits out; doubles form their own suit, with 6-6 highest. You lead
and must avoid taking any of the seven tricks. One trick sets you immediately.
Walt plays the defenders with counterexample search always enabled. Computer auctions still choose straight contracts.

The new table preset retains forced-30 bidding after three passes. Its replay
prefix is `v1l`; old `v1f` links retain their original straight-only rules.
Reloads, original decision receipts, questions, shared hands and move inspection
preserve Nel-O's three-player positions and mark stake.

The shared player and implementation record live in
[Texas 42 issue #89](https://github.com/jasonyandell/texas-42/issues/89) and
`walt/NELLO-PLAYER.md`. The matched WASM manifest identifies its exact source.
The first small defense screen does not establish an advantage over random
defense; all paired reversals are retained. Mac timings are measured, Pixel
timings remain to be checked. This remains an experiment; stronger defense is not established.
See `docs-nello-counterexamples.md` for availability, saved hands and review behavior.
