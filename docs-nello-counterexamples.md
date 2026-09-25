# Nel-O Preview

The browser table's **Advanced settings → Nel-O · Preview** switch enables the
whole feature. It defaults to off and is saved on this device. With it off,
Nel-O cannot be declared and fresh Nel-O analysis is unavailable. A saved hand
already playing Nel-O stays intact but requires the preview to resume; completed
hands, original receipts, shared links and saved questions remain viewable.

`?nello=preview` enables the whole preview; `?nello=off` disables it. Old
`?nello=counterexamples` links now enable the whole preview, and `?nello=ordinary`
turns it off. Existing saved counterexample opt-ins migrate to the preview.
The Mac research transport does not expose this browser-only preview.

Counterexample defense is always requested for computer defenders during Nel-O. It looks for possible
deals where a candidate plan fails, retains a few, and jointly replans the
options. Up to three rounds retain at most 12 deals, with up to two extra seconds
inside the existing move budget. A stopped round keeps the last complete result.
Each subsequent turn replans from that player's own hand and public history.

In **See how it went**, **Ask Walt** and **Think deeper** automatically include
the same counterexample pass for Nel-O defenders. There is no separate switch or
ordinary-only mode. Declarer analysis and straight 42 retain their usual profile.
The pass stays within the existing deadline; it may finish partially or find no
witnesses. Enabling it does not promise that every move produces stress scores.

Ordinary estimates stay visible. A separate **Counterexample stress scores**
table shows sets out of the deliberately constructed bundle; these are not
calibrated chances of setting Nel-O. The panel records the ordinary choice,
retained-deal count, rounds completed, and whether the deadline stopped work.

The prior offline pilot found real vulnerabilities but mixed fresh-deal results.
Stronger play is not established. The source and evidence are in the paired
[Texas 42 PR #96](https://github.com/jasonyandell/texas-42/pull/96), on top of its Nel-O PR. This Plunge
PR likewise builds on the existing Nel-O PR; neither needs to merge for previews.
The normal isolated PR Worker/D1 lifecycle applies (see `docs-previews.md`).
