EXPLORATORY tier.

# Spades: Walt lab report

Page: `public/lab/spades/` (served at `/lab/spades/`). You play South. Your partner North and both opponents (West, East) are Walt. Harness and results: `lab/spades/`.

## Rules implemented

- Standard four-player partnership spades. North/South play against East/West, 52 cards, 13 tricks. Spades are always trump. You must follow suit if you can. You can't lead spades until they are broken (a spade has been played) unless you hold only spades. The deal rotates clockwise and the player left of the dealer bids first and leads first.
- **Bidding is simplified.** Every computer seat, in every searcher, uses the same heuristic bidder: honor tricks, long spades and ruffing values, counted in quarter tricks. Bids run from 1 to 13. Nil and blind nil are disabled. On the page you choose your own bid, and the bidder's suggestion is highlighted. In the h2h, both tables of a deal get the same contracts, so the only thing that differs is card play.
- **Scoring on the page** is standard: a made bid scores 10×bid plus 1 per overtrick (bag), a set bid scores −10×bid, and every 10 bags costs 100. The game ends when a team reaches 500, or falls to −200.
- **Objective in the search and the h2h** is an integer hand payoff with bags amortized: `handScore = tricks ≥ bid ? 10·bid − 9·(tricks − bid) : −10·bid`. Each bag nets +1 − 10 = −9. The payoff is my team's `handScore` minus the opponents'. It is zero-sum, so `maximizes(seat)` is just which team the seat is on. Walt, flat MC and PIMC all optimize exactly this number summed over sampled deals, and the h2h measures exactly this number.
  - Why not a binary "my team makes its bid"? Spades has two live contracts, and the binary goal makes a side indifferent to bags and to setting the opponents. The zero-sum score difference covers both.
  - Walt does not see the game score or the bag count (a simplification).

## Mapping onto Walt's interface (`public/lab/spades/walt.js`, `engine.js`)

| card function | spades |
|---|---|
| `to_move(public)` | `(leader + cards in trick) & 3` |
| `outcome(public)` | after 13 tricks, the integer `payoff(public)`; otherwise not done |
| `private(deal, seat, public)` | the seat's dealt holding minus the played cards (4 suit bitmasks) |
| `legal(private, public)` | follow suit, plus the spade-lead rule. Search uses `options()`: legal cards with touching equivalents merged (the lowest of each run where the cards in between went in earlier tricks). This uses only the decider's hand and the public record |
| `play(public, card)` | copy-on-write `Int32Array`. Records voids: failing to follow, or leading spades before they broke (which means the hand holds only spades) |
| `sample(seat, private, public, n, rng)` | from the seat's own chair: deals the unseen cards to the other three, respecting hand sizes and revealed voids. Bids are not used (no inference). Uniform by rejection; after 30 rejections it falls back to a constrained constructive deal, which is mildly non-uniform |
| `maximizes(seat)` | `seat & 1 === 0` (the payoff is N/S minus E/W) |

`decide` and `value` follow the card:
- I take one `max` or `min` over each group of deals I can't tell apart.
- Every modeled seat decides from its own chair, using its own nested sample of `n0` deals, one rung lower.
- At level 0, the other seats inside the horizon play uniform random legal cards.
- Counts and values are exact integers.

**Lawful levers used:**
- **Horizon** (absolute, in plies from the live decision). Minds and my own chosen moves apply only within it. Beyond it, each deal is finished by a rollout of the rule-based player, which reads only its own hand and the public record. Random rollouts are available too (`rollout: 'random'`).
- **Early exit** at max/min nodes once a move reaches the best payoff still possible in every deal.
- **Common random numbers.** All noise is keyed by a deal-independent tag drawn when a deal is sampled, plus the ply.
- **One answer per information set.** Within a node, a modeled seat that has the same holding in two deals gets the same action (cached).

## Walt settings and cost

| setting | live level | n | n0 | horizon | rollout | bottom rung |
|---|---|---|---|---|---|---|
| page "normal" and **h2h** | 1 | 64 | 4 | 4 plies | rule player | random (as in the card) |
| page "fast" | 1 | 32 | 3 | 4 plies | rule player | random |

Measured ms/move, mean (max):
- **Node, h2h config:** 21–34 ms (max 285–414 ms). That is about 6,000 rollouts per move. The machine was shared (load 4–6 on 4 cores).
- **Node, fast config:** 13 ms (max 156 ms).
- **Chromium page, normal config (Playwright):** 15–46 ms (max 87–130 ms).

A phone at 3–5× slower stays well under the few-seconds budget. Horizon 8 costs about 3× more, and level 2 about 5× more (~140 ms mean at n=16).

## Baselines (`lab/spades/baselines.js`, which uses the same engine module)

- **random:** a uniform legal card.
- **rule:** standard heuristics (`engine.ruleMove`). It wants tricks while its side still needs them or the opponents can still be set, and otherwise ducks to avoid bags. Lead bosses, 2nd hand low, 3rd/4th hand win cheaply, don't overtake a partner who is winning securely, trump low, overtrump cheaply, discard low (shed high when ducking).
- **flatmc (n=64):** sample 64 deals from the decider's chair, score every option by rule-player rollouts, take the best sum. This is exactly Walt with `horizon = 1`. On 300 tuning deals the two agree: 33.24 vs 33.66 against rule.
- **pimc (n=24, depthTricks=1, exactTricks=5):** sample 24 deals and score every option per deal with a perfect-information alpha-beta on the same integer payoff, with a transposition table. It is exact to the end of the hand once 5 or fewer tricks remain. Earlier, it searches the current trick plus one more and puts rule rollouts at the leaves. Mean 14–18 ms/move.
  - Deeper settings (2 tricks deep, exact at 6 or fewer left) cost 75–120 ms/move, which the h2h budget couldn't afford.

## Head-to-head (duplicate, seed 2026)

Each deal is played twice on identical cards and contracts: A sits North/South, then A sits East/West. **diff** is A's payoff minus B's, summed over both tables (per deal, integer). The 95% CI is a normal approximation over deals. "A-only, B-only" counts contracts one side made and the other side did not, holding the same cards in the same seats.

| A vs B | deals | mean diff [95% CI] | deals A ahead/level/behind | contracts made A / B (A-only, B-only) |
|---|---|---|---|---|
| **walt vs rule** | 200 | **+8.8 [−5.2, +22.7]** | 90 / 66 / 44 | 295 / 291 of 400 (53, 49) |
| **walt vs flatmc** | 100 | **+1.9 [−20.1, +23.8]** | 28 / 37 / 35 | 144 / 144 of 200 (28, 28) |
| **walt vs pimc** | 100 | **+2.4 [−18.8, +23.5]** | 30 / 38 / 32 | 147 / 146 of 200 (26, 25) |
| walt vs random | 50 | +165.4 [+139.5, +191.2] | 47 / 2 / 1 | 96 / 19 of 100 (78, 1) |
| flatmc vs rule | 200 | +46.7 [+32.0, +61.5] | 133 / 42 / 25 | 318 / 249 of 400 (96, 27) |
| pimc vs rule | 100 | +12.9 [−6.6, +32.4] | 54 / 27 / 19 | 148 / 141 of 200 (26, 19) |
| flatmc vs pimc | 100 | −7.8 [−29.2, +13.6] | 30 / 32 / 38 | 144 / 149 of 200 (26, 31) |
| rule vs random | 200 | +149.7 [+137.5, +162.0] | 179 / 3 / 18 | 382 / 94 of 400 (290, 2) |

The same 200 deals give a paired comparison against rule: walt − flatmc = **−38.0 [−57.4, −18.6]** per deal. Walt is significantly weaker than flat MC against the rule bot.

Bags when made: walt vs rule had 166 vs 316, and walt vs pimc had 125 vs 100. Full summaries are in `results/SUMMARY.txt`, and per-deal JSONL is in `results/*.jsonl`.

### Tuning data (separate seed 7, not the evaluation seed; `results/tuning_seed7/`)

These are paired against Walt `horizon=1, n=64` (= flat MC) on the same 150 deals, with rule as the opponent:
- Horizon 4, bottom rung random: **−11.6 [−33.8, +10.6]**.
- Horizon 4 with the bottom rung replaced by the rule player (a deviation from the card): −5.5 [−25.9, +15.1].

The root sample size matters far more than depth. Against rule at horizon 1 (300 deals each):
- n=32: +8.7
- n=64: +33.2
- n=128: +50.0

## Reproduce

Run from the repo root (Node 22, no packages; each chunk is under 5 minutes single-process):
```
W=walt:n=64,n0=4,horizon=4; P=pimc:n=24,depthTricks=1,exactTricks=5; R=lab/spades/results
node lab/spades/h2h.mjs $W rule          --seed 2026 --from 0 --to 200 --out $R/walt_vs_rule.jsonl
node lab/spades/h2h.mjs $W flatmc:n=64   --seed 2026 --from 0 --to 100 --out $R/walt_vs_flatmc.jsonl
node lab/spades/h2h.mjs $W $P            --seed 2026 --from 0 --to 100 --out $R/walt_vs_pimc.jsonl
node lab/spades/h2h.mjs $W random        --seed 2026 --from 0 --to 50  --out $R/walt_vs_random.jsonl
node lab/spades/h2h.mjs flatmc:n=64 rule --seed 2026 --from 0 --to 200 --out $R/flatmc_vs_rule.jsonl
node lab/spades/h2h.mjs $P rule          --seed 2026 --from 0 --to 100 --out $R/pimc_vs_rule.jsonl
node lab/spades/h2h.mjs flatmc:n=64 $P   --seed 2026 --from 0 --to 100 --out $R/flatmc_vs_pimc.jsonl
node lab/spades/h2h.mjs rule random      --seed 2026 --from 0 --to 200 --out $R/rule_vs_random.jsonl
node lab/spades/summarize.mjs $R/walt_vs_rule.jsonl ...                    # table rows
node lab/spades/compare.mjs $R/walt_vs_rule.jsonl $R/flatmc_vs_rule.jsonl  # paired
```
The runs are deterministic: re-running gives identical JSONL lines (only the ms fields vary). The final runs took about 17 CPU-minutes and tuning about 14, all single-process.

Other tools in `lab/spades/`:
- `bench_walt.mjs` and `bench_baselines.mjs`: ms/move.
- `check_sample.mjs`: 62,400 sampled deals checked for hand sizes, voids and no overlap; 0 violations.
- `e2e.cjs` and `shot.cjs`: Playwright page checks. Serve `public/` with `python3 -m http.server 8765` and run with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

## Page verification

Playwright (Chromium) played as South, picking the suggested bid and then random legal cards:
- **Desktop, 1000×800:** in `?quick` mode (no animation pauses) the game ran to its end in 5 hands.
- **Phone, 360×740:** one hand at normal pacing.
- **Desktop, normal pacing:** a mid-hand screenshot.

No console errors or page errors. No horizontal overflow at 360 px (scrollWidth 360). Walt runs in a module Web Worker, which receives only the deciding seat's own cards and the public record.

## Caveats

- **The opponent-model confound.** The rule player is both a baseline and the rollout policy. So flat MC (= Walt at horizon 1) has a *perfect* model of the rule bot beyond the root. Walt's ladder swaps that model for level-0 minds within the horizon: best responses to random play, deciding from `n0 = 4` worlds. Against the rule bot this is pure loss, which is the −38 paired gap. Against PIMC, where neither has an exact model, Walt and flat MC tie.
- **PIMC is depth-limited.** It is exact only for the last 5 tricks; earlier it searches one trick ahead and finishes with rule rollouts. It is not a full double-dummy solver: endplay/DDS uses bridge rules, which have no spade-leading restriction, and lives outside the shared JS code path. A deeper PIMC might be stronger.
- **Bidding is the same heuristic everywhere.** Nil is disabled. Sampling ignores bids. This is lawful, but it weakens every sampler equally.
- **Approximations in the search.** Touching-card equivalence and the constructive sampling fallback are approximations. Walt's objective amortizes bags and ignores the game score.
- **Small samples.** The three headline Walt comparisons are all inside ±23 points per deal (about ±0.2 contracts). Effects smaller than that are not resolved. Level 2 and horizon 8 or more were not evaluated head-to-head (cost).
- **No external review.** The Agent tool (fable) was not available in this session.

## Verdict

**Practical with caveats.**
- **Cost fits.** Walt runs well inside the browser budget (tens of ms per move) and plays sound spades: +165 per deal against random, and a tie with the standard samplers. The card's interface maps cleanly once the outcome is generalized to an integer, zero-sum hand payoff.
- **No added strength.** At affordable settings the ladder adds nothing measurable over flat Monte Carlo with the same rollout policy. It is clearly worse when that rollout policy *is* the opponent. In spades, the random bottom rung is a poor model of real players, and a 13-trick hand forces a short horizon. So most of Walt's strength comes from the rollout policy beyond the horizon and the root sample size, not from the ladder.
- **Untested.** Whether a deeper horizon or level 2 would change this is untested.

## Rerun: Walt with 4× root samples (n = 256)

EXPLORATORY tier. One variable changed: root deals n=64 → n=256. n0=4, horizon=4, the rule-player rollouts, the seed, the deals and the duplicate protocol are all unchanged. The shipped page keeps its n=64 setting.

Commands (repo root, Node 22, single process, foreground, chunked under about 9 minutes; `h2h.mjs` appends to `--out`):
```
W=walt:n=256,n0=4,horizon=4; R=lab/spades/results
node lab/spades/h2h.mjs $W rule        --seed 2026 --from 0   --to 10  --out $R/walt256_vs_rule.jsonl    # timing probe, kept
node lab/spades/h2h.mjs $W rule        --seed 2026 --from 10  --to 60  --out $R/walt256_vs_rule.jsonl
node lab/spades/h2h.mjs $W rule        --seed 2026 --from 60  --to 115 --out $R/walt256_vs_rule.jsonl
node lab/spades/h2h.mjs $W rule        --seed 2026 --from 115 --to 160 --out $R/walt256_vs_rule.jsonl
node lab/spades/h2h.mjs $W rule        --seed 2026 --from 160 --to 200 --out $R/walt256_vs_rule.jsonl
node lab/spades/h2h.mjs $W flatmc:n=64 --seed 2026 --from 0   --to 50  --out $R/walt256_vs_flatmc.jsonl
node lab/spades/h2h.mjs $W flatmc:n=64 --seed 2026 --from 50  --to 100 --out $R/walt256_vs_flatmc.jsonl
node lab/spades/summarize.mjs $R/walt256_vs_rule.jsonl
node lab/spades/compare.mjs   $R/walt256_vs_rule.jsonl $R/flatmc_vs_rule.jsonl   # paired walt256 - flatmc
node lab/spades/compare.mjs   $R/walt256_vs_rule.jsonl $R/walt_vs_rule.jsonl     # paired walt256 - walt64
node lab/spades/summarize.mjs $R/walt256_vs_flatmc.jsonl
node lab/spades/bench_walt.mjs '[{"n":64,"n0":4,"horizon":4},{"n":256,"n0":4,"horizon":4}]' 10
```

| | Walt n=64 (existing) | Walt n=256 (new) |
|---|---|---|
| vs rule, 200 deals: mean diff per deal [95% CI] | +8.8 [−5.2, +22.7] | **+37.2 [+22.4, +52.0]** |
| vs rule: deals ahead / level / behind | 90 / 66 / 44 | 114 / 57 / 29 |
| vs rule: contracts made, Walt / rule (Walt-only, rule-only) | 295 / 291 (53, 49) | 320 / 265 (83, 28) |
| Paired walt − flatmc (flatmc n=64 is +46.7 [+32.0, +61.5] vs rule), 200 deals | −38.0 [−57.4, −18.6] | **−9.5 [−30.2, +11.1]** |
| Paired walt256 − walt64, 200 deals | n/a | +28.5 [+12.2, +44.7] |
| vs flatmc n=64, 100 deals: mean diff [95% CI] | +1.9 [−20.1, +23.8] | **+38.9 [+16.6, +61.1]** |
| vs flatmc: deals ahead / level / behind | 28 / 37 / 35 | 42 / 38 / 20 |
| vs flatmc: contracts made, Walt / flatmc (Walt-only, flatmc-only) | 144 / 144 (28, 28) | 157 / 127 (45, 15) |
| ms/move from jsonl (mean of per-table means), vs rule run | 33.7 | 124.9 |
| ms/move from jsonl, vs flatmc run | 32.0 | 111.2 |
| `bench_walt.mjs` ms/move, mean (max) | 32.6 (419) | 118.5 (1686) |
| `bench_walt.mjs` rollouts/move | about 6,500 | about 25,000 |

Timing caveat: the machine was shared (load about 5.7 on 4 cores), and the `bench_walt.mjs` runs covered 10 deals. The jsonl files store only per-table means, so the max comes from the benchmark. Mean cost scaled about 3.6× for 4× the samples.

What changed: with 4× root samples Walt moves from tied with rule (+8.8) to clearly ahead (+37.2). The paired gap to flat MC (n=64) against rule shrinks from −38.0 to −9.5, and its CI now includes 0. Against flat MC (n=64) head to head, Walt n=256 is ahead by +38.9 [+16.6, +61.1], where n=64 was a tie. Caveats:
- Walt n=256 uses about 4× the compute of flat MC n=64. Flat MC at n=256 was not run, so this does not show that the ladder adds value at equal samples. The earlier horizon-1 tuning data (seed 7) already showed root n dominating, with +33 at n=64 and +50 at n=128.
- The paired −9.5 against flat MC is unresolved: the CI spans ±20, and the other comparisons have CIs of a similar width.
- The 100-deal vs-flatmc comparison and the 200-deal vs-rule comparison share their first deals (0–99), so they are not independent.
- At about 120 ms mean and 1.7 s max on this loaded machine, n=256 is roughly 4× the shipped page's cost.
