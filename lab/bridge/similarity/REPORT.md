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

**Yes for the position's level; no for the card distinctions within it.**

Variance decomposition of `y` over the 7,998 candidates (`decompose.mjs`):

| component | variance | share |
|---|---|---|
| total var(y) | 0.0901 | 100% |
| between decisions | 0.0804 | 89.2% |
| within a decision (candidate deltas) | 0.0097 | 10.8% |
| …of which n=64 binomial sampling noise (mean y(1−y)/64) | 0.0024 | 2.7% |

Candidate-level prediction, 5-fold CV **by board** (never splitting within a
board), `knn.mjs`:

| model | MSE | MAE | top-1 | regret | top-1 (contested) | regret (contested) |
|---|---|---|---|---|---|---|
| global-mean | 0.0911 | 0.2594 | 56.1% | 0.0437 | 46.0% | 0.0616 |
| strain-mean | 0.0915 | 0.2595 | 56.1% | 0.0437 | 46.0% | 0.0616 |
| strain-level-mean | 0.0939 | 0.2625 | 56.1% | 0.0437 | 46.0% | 0.0616 |
| other-cand-mean* (oracle) | 0.0225 | 0.0807 | — | — | — | — |
| knn-10 | 0.0585 | 0.1893 | 50.0% | 0.0575 | 37.6% | 0.0815 |
| knn-25 | 0.0563 | 0.1895 | 50.0% | 0.0593 | 38.2% | 0.0842 |
| ridge (λ=1) | 0.0547 | 0.1830 | 46.5% | 0.0688 | 33.4% | 0.0984 |

Reading the table:

- **MSE drops ~40%** below the global mean (0.091 → 0.055−0.059); the gain is
  consistent in all five folds (knn-25 per-fold 0.050−0.068 vs global
  0.086−0.103). Alike-looking positions do have alike make-rates.
- The predictions are **well calibrated**: in 10 prediction bins the mean
  actual make-rate tracks the mean prediction within ≤0.03 everywhere
  (`decompose.mjs` prints the table).
- **top-1 is below the no-model baseline.** The constant baselines score 56.1%
  only because ties fall to the first-listed candidate, which is the rule
  bot's card (the tape's root ordering) — i.e. 56.1% is the rule bot, not the
  features. Every learned model ranks *worse* than that, and worse than it
  looks: a model that predicts the position's level but not the candidate
  deltas picks near-arbitrarily among close candidates.
- The failure is structural, not a model-class issue: regressing the
  **within-decision delta** (y − own-decision mean) directly gives test MSE
  0.0096 against var(delta) 0.0097 — **R² ≈ 1%** (ridge; kNN similar). A tiny
  MLP (33→32→16→1 tanh, Adam, 3-seed average per fold; `mlp.mjs`) reaches
  **R² = 0.053** — nonlinearity buys five points, not fifty. With features
  this cheap, the candidate-vs-candidate part of the touch does not transfer
  across boards. Note the ceiling: ~25% of var(delta) is n=64 sampling
  noise, so a perfect predictor could reach R² ≈ 0.75 here; 1−5% is nowhere
  near that excuse.
- Transfer across deal sets is real: training on the tune-deal corpus
  (disjoint 120 deals) and testing on all 60 test-deal boards gives the same
  picture (see Q3 table) — slightly better MSE than within-set CV, since the
  train set is larger.

The one-line summary: **cheap public features recover the touch's intensity,
calibrated, but not its shape.** Position-level similarity is measurable;
candidate-level similarity is not, at this feature budget.

## Q2 — what does a prior save?

**Nothing, at this feature budget: every learned-prior policy is dominated by
an equal-cost sampling alternative (or by the rule bot at zero cost). What
does save cost is the refine ladder itself, with a tiny sampling pass as the
proposer.**

Setup (`replay.mjs`, `policy.mjs`): every corpus decision was re-run through
`waltDecide` at the full config (byte-identical vectors → the audit above) and
at two cheap configs. Costs are deterministic `stats.nodes`; the unit below is
the mean full-evaluation cost per decision (7.66 M nodes ≈ 0.7−1.3 s/move).
The cheap passes measured: n8/n04 ≈ **2.1%** of full, n16/n08 ≈ **7.8%**.
"Refine set S" plays the truth-argbest within S (justified exactly by the
byte-identical reproduction) and is costed as `nodes_full · |S|/|cands|` — a
proxy; see caveats. Regret is make-probability given up vs full Walt's pick;
priors/gates are trained with 5-fold board hygiene.

| policy | cost (× full) | mean regret | best-value pick % |
|---|---|---|---|
| rule-first (no search) | 0.000 | 0.0437 | 56.1% |
| **knn prior pick (no search)** | 0.000 | **0.0595** | 49.3% |
| n8/n04 pick | 0.021 | 0.0348 | 57.3% |
| n16/n08 pick | 0.078 | 0.0298 | 58.8% |
| gate(τ=0.04) → n16+refine top-2 | 0.271 | 0.0241 | 67.8% |
| knn top-1 + rule (refine 2) | 0.341 | 0.0266 | 67.2% |
| n8 gate(spread<0.2) → n16+refine top-2 | 0.363 | 0.0198 | 69.7% |
| **knn finalists top-2 (refine only)** | 0.441 | **0.0202** | 75.0% |
| **rule + arbitrary other (refine 2) [control]** | 0.441 | **0.0167** | 76.3% |
| n8/n04 + refine top-2 | 0.462 | 0.0124 | 79.6% |
| n16/n08 + refine top-2 | 0.519 | 0.0109 | 80.4% |
| n8/n04 + refine top-3 | 0.610 | 0.0064 | 87.8% |
| n16/n08 + refine top-3 | 0.666 | 0.0050 | 89.4% |
| gate(τ=0.02) → full | 0.924 | 0.0048 | 95.4% |
| n8 gate(spread=0) → full | 0.948 | 0.0031 | 95.2% |
| full Walt | 1.000 | 0.0000 | 100.0% |

(`policy.mjs` prints more rows — eps-adaptive finalist sets, more gate
thresholds. The n8 eps rows collapse because an 8-deal estimate is quantized
to 1/8; eps below that keeps exact ties only.)

The three findings:

1. **The learned prior fails exactly where Q1 said it would.** As a picker it
   is worse than the rule bot (0.0595 vs 0.0437 at zero cost). As a finalist
   selector, "refine the prior's top-2" (0.441, 0.0202) is **worse than
   refining the rule card plus an arbitrary second candidate** at the same
   cost (0.0167) — the prior's within-position ranking is worse than
   arbitrary, because it confidently misranks while the control at least
   always keeps the strong rule card.
2. **Tiny sampling passes are the real proposer.** The whole efficient
   frontier is sampling-first: n8 pick (2% cost, regret 0.0348), n16 pick
   (8%, 0.0298), n8+refine top-2 (46%, 0.0124), n16+refine top-3 (67%,
   0.0050), full (100%, 0). The 2%-cost n8 pass puts the true best card in
   its top-2 at 79.6% of decisions; no learned model here comes close at any
   cost.
3. **Intensity gating works, but only as well as sampling gates.** The
   learned gate (predicted skip-regret, kNN-25 over decision features) at
   τ=0.04 gives 0.271 cost / 0.0241 regret — a real knob (45% of skip-regret
   removed at 27% cost, with zero sampling on gated-off decisions), but it
   sits slightly inside the line between neighbouring sampling policies
   (interpolating n16-pick and n8-gate→refine gives ≈0.023 at that cost). The
   one thing the learned prior provably predicts — where thinking is needed —
   a 2%-cost n8 probe measures about as well by just touching the position.

So the answer to "how much does a prior save?" is: **the prior that saves is
the sampling prior.** The corpus-learned one, at this feature budget, is
dominated at every rung. The useful artifact this question surfaced is the
ladder itself: `blunt n8 → refine finalists at full settings` recovers 85−90%
of the skip-regret at half to two-thirds of the cost, using only machinery
`tape.js` already has.

## Q3 — corpus-size scaling

TBD.

## Reproduce

TBD.

## Caveats

TBD.

## Verdict

TBD.
