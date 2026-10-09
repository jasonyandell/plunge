# Stochastic similarity: are positions "alike" because their outcomes are alike?

EXPLORATORY tier. Measurements on one machine (Node 24, Apple Silicon), small
corpora, one family of featurizations; claims are sized accordingly.

**The question** (Jason's framing): Walt is a sense, not a brain — a pmake
vector is a touch report ("press here, the contract makes 51/64 times"). Do
positions that *look* alike through cheap public features *feel* alike — do
they have alike pmake vectors? If yes, a memory of old touch reports could
propose estimates that full sampling only refines. This report measures (1)
whether alike positions have alike vectors, (2) what a learned prior saves in
sampling cost, and (3) how prediction quality scales with corpus size.

## Corpus

`lab/bridge/results/pmake/selfplay.jsonl` (test set, in-repo): 60 boards of
vector-mode self-play by the final full-depth tape config
(`n=64, n0=32, l0Tail=28, k=2, selfs=mind, l0=flat, field`), 2,012 non-forced
decisions, 7,998 exact candidate make-counts (all over 64 sampled deals).
Target variable `y = makes/64`.

Train corpora for cross-deal transfer: the same config self-played on
`deals-tune.json` (120 deals, zero PBN overlap with the test deals), seeds 1-2
(`results/pmake/tune-s{1,2}-{a,b,c}.jsonl`).

Every corpus position reconstructs by replaying `plays` through `Pub`;
`checks.mjs` asserts seat/legality/outcome invariants on all 2,012 decisions
and — with `--repro N` — re-runs `waltDecide` at stored positions.
**The full-config replay reproduced all stored vectors byte-identically from a
cold mind cache** (purity / play-invariance of the field, now verified at every
corpus decision via `replay.mjs --assert 1`). This matters below: "refine
candidate set S at full settings" provably returns the stored values.

## Featurization (the information rule)

Every feature reads only the deciding agent's visible hands (its seat's
remaining hand; partner/dummy when that agent may see them) and the public
record — a predictor built on them is lawful as a live prior. Position block:
strain/level, tricks needed by each side, tricks remaining, plies left, trick
position, role (declarer side / dummy's turn), own trump and led-suit lengths,
who holds the current trick, opponents' shown voids, candidate count. Candidate
block: suit class (trump / follow / discard / lead), would-it-win-now, higher
cards split into own / visible-partner / visible-opponent / unseen, master
flag, own suit length, rank, rule-bot card flag, lowest/highest-of-suit flags,
ruff flag, partner-led flag, trick index. 33 features total (`data.mjs`).

## Q1 — do alike positions have alike vectors?

TBD: CV table, decomposition, delta result, calibration.

## Q2 — what does a prior save?

TBD: policy cost-regret table.

## Q3 — corpus-size scaling

TBD.

## Reproduce

TBD.

## Caveats

TBD.

## Verdict

TBD.
