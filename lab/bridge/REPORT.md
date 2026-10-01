EXPLORATORY tier.

# Bridge card play vs Walt

Everything below is an exploratory measurement on small samples. Nothing here is a
proof or a receipt.

## What was built

- `public/lab/bridge/` is the page, served at `/lab/bridge/`. It is plain ES modules with no build step:
  - `engine.js` holds the rules, deals, the contract rule, the sampler, the rule bot and the rollout simulator.
  - `walt.js` holds Walt (`decide`/`value`).
  - `worker.js` runs Walt in a Web Worker.
  - `main.js`, `index.html` and `style.css` are the UI.

  You sit South. In **Declare** mode you are declarer and also play dummy North; Walt
  defends East and West, each from its own chair. In **Defend** mode Walt declares from
  East (playing dummy West) and Walt is also your partner North; you make the opening
  lead. The page shows the contract, tricks for each side, the current trick, the last
  trick, and Walt's own estimate for its last card ("contract makes in x/n of the deals
  Walt sampled"). There are three strengths (Quick / Standard / Deep). `?deal=N&seat=declare|defend`
  reproduces a deal.
- `lab/bridge/` holds everything not deployed:
  - `h2h.mjs` is the duplicate harness. It imports the same engine and Walt modules as the page.
  - `players.mjs` holds the Walt, PIMC, rule and random players.
  - `dds_server.py` and `dds.mjs` provide the double-dummy oracle (endplay/DDS via a JSON-lines subprocess).
  - `deals.mjs` screens deals with DDS.
  - `summarize.mjs` produces the tables.
  - `selfcheck.mjs` and `conformance.mjs`/`.py` are the checks.
  - `deals-test.json` and `deals-tune.json` are the deal sets; `results/*.jsonl` is every board played.

## Rules variant and simplifications

- **Play phase only, standard rules.** Declarer's left-hand opponent leads and dummy is
  face up after the opening lead. Declarer plays both hands. The usual rules apply:
  follow suit, trumps beat side suits, and the trick winner leads next.
  - **Conformance check:** 300 random games across all five strains were replayed by
    endplay. Every card was legal there and there were 0 trick-winner mismatches.
- **No auction.** A deterministic rule assigns the contract (`contractFor`):
  - The side with more HCP declares. At 20–20, North/South declares.
  - **Strain:** an 8+ card major fit (the longer major, spades on a tie). Otherwise NT
    with 25+ HCP. Otherwise an 8+ card minor fit. Otherwise NT.
  - **Level by combined HCP.** For NT: ≤22 → 1NT, 23–24 → 2NT, 25–32 → 3NT, 33–36 →
    6NT, 37+ → 7NT. For a major, use HCP + extra trumps: ≤21 → 2, 22–23 → 3, 24–32 → 4,
    33–36 → 6, 37+ → 7. For a minor: ≤21 → 2, otherwise 3.
  - **Declarer:** in a suit, the partner with the longer trumps; in NT, the partner with
    more HCP.
- **Binary objective:** the contract makes or it doesn't. There is no scoring, and no
  doubling or vulnerability. In the h2h, play stops once the result is decided. The page
  plays on to 13 tricks.
- **Belief is the same for every searcher.** Both Walt and PIMC sample uniformly over
  deals consistent with:
  - the hands the decider sees;
  - hand sizes;
  - revealed voids.

  Neither one conditions on the contract rule. This is the card's "no inference from
  anyone's policy", and it applies to the auction stand-in too.
- **Deal sets are screened by double dummy to tight contracts.** A deal is kept when its
  DD declarer tricks are within 1 of the target.
  - **Test set:** seed 7, 60 kept of 80 deals. 16 are one trick short DD, 20 are exact
    and 24 are one over.
  - **Tuning set:** seed 2026. Boards 80–99 were used for tuning. They are disjoint from
    the test set.

  The contracts in the test set are 1NT ×9, 2NT ×4, 3NT ×7, 2–3 of a minor ×14, 2–3 of
  a major ×10 and 4M ×16.

## How bridge maps onto Walt's seven functions

| card | bridge |
|---|---|
| `to_move` | `agentOf(pub, seat)`. There are three deciders: **declarer** (who also owns dummy's turns), LHO and RHO |
| `outcome` | made / defeated, settled early once either side has enough tricks (plus the margin terms below) |
| `private(deal, a)` | the remaining hands `a` may see. Declarer sees declarer + dummy; a defender sees its own hand, plus dummy after the opening lead |
| `legal` | follow suit; touching cards collapse to one representative (cards whose gaps lie only in the same hand or in *completed* tricks) |
| `play` | `Pub.apply` / `undo`, shared by every deal in a group |
| `sample` | `sampleDeals`: uniform among consistent deals. With 2 hidden hands it is exact: void-forced cards are assigned, then a uniform split of the rest. With 3 hidden hands (the opening lead only) it shuffles and deals |
| `maximizes` | declarer side maximizes; defenders minimize |

### Information rule

- **Declarer:** a declarer decision for either hand reads declarer's hand, dummy and the
  public record.
- **Defenders:** a defender reads its own hand, dummy (after the lead) and the record.
- **Modeled seats:** each modeled seat decides from its own chair with its own nested
  sample (`n0` deals).
- **My own turns:** the card's "one action for every deal I can't tell apart" groups my
  deals by my view at my own turns. That matters in one case only: the opening leader's
  sampled worlds have different dummies, and dummy becomes visible after the lead, so the
  leader's later choices are grouped by dummy.
- **Self-check** (`selfcheck.mjs`): in 232/232 positions, `waltDecide` returned the same
  card whether it was given the whole deal or only the seats the agent may see. The same
  run checked:
  - 2080 apply/undo round-trips;
  - 8320 sampled deals for visible hands, hand sizes and voids.

### What Walt optimizes

The primary objective is the number of sampled deals in which the contract makes.
Declarer maximizes it and the defenders minimize it. The card's binary `outcome` is used
with one addition, a **margin tie-break**:

- **The per-deal payoff** is `1024·[made] + [made with an overtrick] + [not down two]`.
- **The make count still decides.** With ≤ 511 deals, the margin terms always sum to
  less than 1024, so the make count is exactly lexicographically primary.
- **What the margin terms do:** they only separate moves that make equally often.

Why it is needed: Walt's model of the opponents is weak (see the caveats). Many positions
therefore *saturate*, with every sampled deal making, and without a tie-break the choice
falls to whichever card is tried first. On tuning boards 0–11, a 12-board look gave
−4 without the tie-break and −1 with it, against PIMC. That run was not saved, so treat
it as anecdotal. PIMC's tie-break, total DD tricks, plays the same role.

## Walt settings and cost

- **Ladder and horizon.** The live player is **level 1**. Modeled seats are level 0
  (they best-respond to random play) within a **horizon of 8 plies (two tricks)** from the
  root. After that, all four seats play the cheap deterministic **rule bot** to the end
  of each sampled deal. Each rule-bot seat reads only its own hand, plus its partner's
  hand if it is declarer/dummy, plus the record. Random rollouts are also implemented
  ("dice after", `rollout:1`).
- **Lawful levers used:**
  - `n`, `n0` and the horizon;
  - early exit at saturation, both at Walt's own turns and inside modeled minds;
  - common random numbers (the noise stream is reseeded identically for every candidate card);
  - touching-card equivalence;
  - the rule bot's card is tried first, so it wins ties and is the first early-exit candidate.
- **Exact integers** are used throughout the search. There are no floats in values; the
  RNG is xorshift32.

### Speed

H2h setting = page **Standard**: `L1, n=32, n0=8, horizon=8, rule-bot rollouts, margin`.

**Node 22**, on this shared 4-core box with five other builders running. The figures are
per Walt move, including forced moves, over the 60-board run.

| role | moves | mean | median | p90 | p99 | max |
|---|---|---|---|---|---|---|
| Walt declaring | 1366 | 138 ms | 36 ms | 416 ms | 1045 ms | 3499 ms |
| Walt defending | 1360 | 158 ms | 41 ms | 498 ms | 1078 ms | 1817 ms |

**Browser** (headless Chromium, same box), full games through the page:
- **Standard:** max 1.35 s over 4 games.
- **Deep** (`n=64, n0=8, h=8`): max 3.4 s and typically 0.1–2 s on the opening tricks.
- **Quick** (`n=16, n0=4, h=8`): well under a second.

A phone-class CPU might be 2–3× slower. That would put Standard at about ≤1.5 s on 90% of
moves and a rare few seconds; Deep is the "slower" option.

What hitting a few seconds took:
- **No horizon is impractical.** The full ladder (`n=8, n0=2`) was probed on one board:
  most moves were cheap (p90 288 ms), but one move took **435 s**. Defending, the early
  exit (0 makes) rarely fires, so Walt walks its own choice tree to the end of the hand.
- **A horizon of 8–12 plies is affordable.** Horizon 12 at `n=16` cost a mean of 230 ms
  and a max of 4.9 s.
- **Level 2 costs about 16× level 1** at h8 n16: mean 703 ms, max 7.6 s. It was not
  pursued, since 7 boards showed no sign of a gain.
- **Rollouts are about 70% of the profile**, split between the rule bot and the simulator.

## Baselines

- **PIMC(W=20) with exact double dummy**, the standard bridge card-play method. It works
  as follows:
  - It samples 20 worlds with the same sampler as Walt.
  - Each world is solved for every legal card with DDS (endplay 0.5.12, `solve_board`).
  - It plays the card that makes (or, defending, defeats) the contract in the most
    worlds. Ties go to total DD declarer tricks, then to the rule bot's card.

  It took a mean of 54 ms per move declaring and 97 ms defending, and up to 3.9 s at
  opening leads.
- **Rule bot**, used as a floor and also as Walt's rollout policy:
  - It draws trumps when its side has more of them.
  - It cashes masters.
  - Otherwise it leads low from its longest side suit.
  - Second hand plays low; third/fourth hand wins as cheaply as possible.
  - It ruffs or overruffs when it can't follow and its partner isn't winning.
  - Otherwise it discards low from its longest side suit.
- **Random legal**, as a floor.

## Head-to-head (duplicate)

Every board is played at several tables on the same deal and contract. Table **XY** means
X declares (and plays dummy) and Y defends. The duplicate pair is AB vs BA:
`diff = made(AB) − made(BA)`, and a value above 0 favours A. The same-player table BB
splits declarer play from defence. Intervals are 95% normal-approximation intervals on the
per-board differences. The test set is `deals-test.json` (seed 7), `--seed 1`.

### Walt (L1 n32 n0=8 h8) vs PIMC(W20): 60 boards, tables AB, BA, BB

| table | made |
|---|---|
| Walt declares vs PIMC defence (AB) | 43/60 (72%) |
| PIMC declares vs Walt defence (BA) | 51/60 (85%) |
| PIMC declares vs PIMC defence (BB) | 48/60 (80%) |

| comparison | mean diff [95% CI] | boards +1 / 0 / −1 |
|---|---|---|
| **duplicate: Walt − PIMC (both seats)** | **−0.133 [−0.261, −0.006]** | 4 / 44 / 12 |
| declarer play: Walt − PIMC, both vs PIMC defence | −0.083 [−0.217, +0.051] | 6 / 43 / 11 |
| defence: Walt − PIMC, both vs PIMC declarer | −0.050 [−0.168, +0.068] | 5 / 47 / 8 |

### Floors (same test deals)

| pair | boards | A declares made | B declares made | duplicate A − B [95% CI] | +1/0/−1 |
|---|---|---|---|---|---|
| Walt vs rule | 0–29 | 26/30 | 14/30 | **+0.400 [+0.198, +0.602]** | 13/16/1 |
| PIMC vs rule | 0–29 | 27/30 | 12/30 | **+0.500 [+0.295, +0.705]** | 16/13/1 |
| rule vs random | 0–59 | 53/60 | 7/60 | +0.767 [+0.659, +0.875] | 46/14/0 |

### Tuning probes

These used tuning-set boards 80–99, so the deals are disjoint from the test set. They are
noise-level, and `results/tune/` holds them.

| Walt variant vs PIMC(W20) | boards | duplicate diff [95% CI] | Walt ms/move mean / max |
|---|---|---|---|
| n16 n0=4 h8 | 20 | −0.200 [−0.380, −0.020] | 43 / 445 |
| **n32 n0=8 h8** (chosen) | 20 | −0.050 [−0.223, +0.123] | 169 / 2009 |
| n16 n0=4 h12 | 18 (timed out) | −0.222 [−0.420, −0.025] | 230 / 4916 |
| L2 n16 n0=4 h8 | 7 (timed out) | −0.286 [−0.846, +0.274] | 703 / 7604 |
| rule-bot rollouts vs random rollouts, Walt vs Walt n16 h8 | 20 | +0.150 [−0.064, +0.364] for the rule-bot version | 43 vs 35 |

H2H CPU: about 19 min for the final runs and about 12 min of tuning probes, single process.

## Reproduce

```sh
python3 -m venv /tmp/bridge-venv && /tmp/bridge-venv/bin/pip install endplay==0.5.12
export DDS_PYTHON=/tmp/bridge-venv/bin/python
cd <plunge>
node lab/bridge/selfcheck.mjs
node lab/bridge/conformance.mjs | $DDS_PYTHON lab/bridge/conformance.py
node lab/bridge/deals.mjs --seed 7 --count 60 > lab/bridge/deals-test.json
node lab/bridge/deals.mjs --seed 2026 --count 120 > lab/bridge/deals-tune.json
# main run (about 3 min per 15 boards; split under 10 min per call)
for r in "0 15" "15 30" "30 45" "45 60"; do set -- $r
  node lab/bridge/h2h.mjs --deals lab/bridge/deals-test.json --a walt --b pimc \
    --walt '{"n":32,"n0":8,"horizon":8}' --W 20 --tables AB,BA,BB --seed 1 \
    --from $1 --to $2 --out lab/bridge/results/walt-vs-pimc.jsonl; done
node lab/bridge/h2h.mjs --deals lab/bridge/deals-test.json --a walt --b rule --walt '{"n":32,"n0":8,"horizon":8}' \
  --tables AB,BA --seed 1 --from 0 --to 30 --out lab/bridge/results/walt-vs-rule.jsonl
node lab/bridge/h2h.mjs --deals lab/bridge/deals-test.json --a pimc --b rule --W 20 \
  --tables AB,BA --seed 1 --from 0 --to 30 --out lab/bridge/results/pimc-vs-rule.jsonl
node lab/bridge/h2h.mjs --deals lab/bridge/deals-test.json --a rule --b random \
  --tables AB,BA --seed 1 --from 0 --to 60 --out lab/bridge/results/rule-vs-random.jsonl
node lab/bridge/summarize.mjs lab/bridge/results/*.jsonl
```

All play is deterministic given the seeds. Decision noise seeds depend only on
(`--seed`, board, table, ply), never on the cards. Re-running boards 2–3 reproduced every
table's card sequence exactly. `--a walt --b walt2 --walt2 '{…}'` compares two Walt
configurations.

## Caveats

- **The sample is small.** The headline interval only just excludes 0. The
  declarer/defence split is not significant on its own.
- **Walt's opponent model is the weak point.** Within the two-trick horizon, Walt's
  modeled opponents are level 0, which means best response to *random* play. Beyond the
  horizon everyone is the rule bot. Both are much weaker than PIMC's clairvoyant
  double-dummy defenders and declarers, so Walt's estimates are optimistic and often
  saturate (e.g. "32/32 makes" at trick 1). That is why the margin tie-break was needed.
  In bridge most of Walt's strength is set by the cheap post-horizon policy, not by the
  ladder.
- **PIMC has the known strategy-fusion flaw**, but exact DD per world is a very strong
  evaluator for make/defeat on single-dummy tight contracts. Walt has no fusion but
  evaluates beyond two tricks with a crude playout.
- **No auction inference** for either side, and contracts come from a fixed rule rather
  than bidding. Tight-contract screening by DD concentrates the boards where play matters.
- **Timings are noisy.** They come from a shared, loaded 4-core machine. Browser times
  are from headless Chromium on the same box, not from a phone.

## Verdict

**Practical with caveats.**

- **It fits and runs.** Bridge play fits Walt's interface cleanly. The one subtlety is
  the declarer agent reading declarer + dummy, and the opening leader's grouping by
  dummy. A lawful Walt runs at about 0.15 s mean and ≤ 3.5 s max per move (Standard)
  with a two-trick horizon and rule-bot playouts.
- **It beats the floor.** Walt clearly beats the rule bot (+0.40).
- **It trails the standard method.** Walt is behind PIMC with exact double dummy:
  −0.13 make-rate per board on 60 duplicate boards, CI [−0.26, −0.01].
- **What was cut:**
  - The full ladder: there is no horizon in the card, and 13 tricks × two hands for
    declarer makes the uncut recursion blow up (a 435 s move).
  - Higher levels: level 2 costs about 16×.
  - Larger `n`.

  What remains is mostly "two tricks of reasoning + a heuristic playout". To compete with
  PIMC, it would need a much better post-horizon model: a stronger rule bot, or a
  bounded-depth lawful search.
