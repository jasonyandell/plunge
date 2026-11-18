# Nel-O defense

Nel-O is available by default in the browser and at family tables. The solo
**More → Settings → Nel-O** switch is a regular rule preference. Turn it off for
straight 42 only. A saved hand already playing Nel-O stays intact if it is turned
off and can resume when it is turned back on. Completed hands, original receipts,
shared links and saved questions remain viewable. Fresh browser analysis is
available for saved Nel-O positions regardless of the current rule preference.

Old preview-era saves migrate to Nel-O enabled; subsequent explicit on/off choices
are saved on this device as `nelloEnabled`. `?nello=on` and `?nello=off` set that
preference. Old `?nello=preview` and `?nello=counterexamples` links still turn it on;
`?nello=ordinary` still turns it off. The Mac research transport remains outside
this browser-only feature.

Counterexample defense is always requested for computer defenders during Nel-O. It looks for possible
deals where a candidate plan fails, retains a few, and jointly replans the
options. Each round searches 540 candidate deals. Up to three rounds retain at most 12 deals, with up to 4.2 seconds
reserved inside the existing move budget. A stopped round keeps the last complete result.
Each subsequent turn replans from that player's own hand and public history.

In **See how it went**, **Ask Walt** and **Think deeper** automatically include
the same counterexample pass for Nel-O defenders. Ask Walt starts at 40 sampled
deals; Think deeper requests 350. The More → Settings → Think deeper setting also requests
350 for computer moves, including straight 42. With it off, the automatic bidder
opening stays at 160 and later moves at 40. Old 160- and 500-world saved hints remain readable. There is no separate switch or
ordinary-only Nel-O mode. Counterexample search applies only to Nel-O defenders;
declarer and straight-42 analysis use ordinary sampling.
The pass stays within the existing deadline; it may finish partially or find no
witnesses. Enabling it does not promise that every move produces stress scores.

Ordinary estimates stay visible. A separate **Counterexample stress scores**
table shows sets out of the deliberately constructed bundle; these are not
calibrated chances of setting Nel-O. The panel records the ordinary choice,
retained-deal count, rounds completed, and whether the deadline stopped work.

The prior offline pilot found real vulnerabilities but mixed fresh-deal results.
Stronger play is not established. The source and evidence are in
[Texas 42 PR #96](https://github.com/jasonyandell/texas-42/pull/96). Promotion of
Nel-O as a regular game option does not change the defense or its evidence.

The earlier 500/768 configuration’s small [headroom timing panel](https://github.com/jasonyandell/texas-42/blob/codex/nello-counterexamples/walt/probes/nello-headroom-2026-09-24/REPORT.md)
completed all rounds at 500 worlds. Its Node/WASM timings on the development Mac
were about 3.1 times the prior deeper profile in aggregate; early decisions took
2.7–3.9 seconds. These are not physical-phone timings or evidence of stronger play.

The current 350-sample / 540-candidate configuration reduces both work requests
by about 30%, with the counterexample reservation reduced from six to 4.2 seconds.
Actual browser latency depends on the position and device.
