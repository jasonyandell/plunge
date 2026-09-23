# Nel-O counterexample preview

Open the preview with `?nello=counterexamples` to enable the experiment.
`?nello=ordinary` selects ordinary Walt. The Home screen's Advanced settings
also has a **Nel-O counterexamples** switch; the choice is saved on this device.

This setting applies to computer defenders during Nel-O. It looks for possible
deals where a candidate plan fails, retains a few, and jointly replans the
options. Up to three rounds retain at most 12 deals, with up to two extra seconds
inside the existing move budget. A stopped round keeps the last complete result.
Each subsequent turn replans from that player's own hand and public history.

In **See how it went**, select a defender's play and press **Try counterexamples**
to compare the experiment with an ordinary estimate. That button works even when
the live setting is off. **Think deeper** requests an ordinary 160-world recheck;
if that completes, Try counterexamples uses 160 as well.

Ordinary estimates stay visible. A separate **Counterexample stress scores**
table shows sets out of the deliberately constructed bundle; these are not
calibrated chances of setting Nel-O. The panel records the ordinary choice,
retained-deal count, rounds completed, and whether the deadline stopped work.

The prior offline pilot found real vulnerabilities but mixed fresh-deal results.
Stronger play is not established. The source and evidence are in the paired
[Texas 42 PR #96](https://github.com/jasonyandell/texas-42/pull/96), on top of its Nel-O PR. This Plunge
PR likewise builds on the existing Nel-O PR; neither needs to merge for previews.
The normal isolated PR Worker/D1 lifecycle applies (see `docs-previews.md`).
