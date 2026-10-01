EXPLORATORY tier.

# Euchre: Walt lab report

Page: `public/lab/euchre/` (served at `/lab/euchre/`). Harness and records: `lab/euchre/`.
All numbers below come from the commands in **Reproduce** and the logs in `lab/euchre/results/`.

## Rules variant implemented

Straight four-hand euchre: 24 cards (9 through A), 5 cards each, 3 buried plus the turned-up card.
- **Auction, round 1:** starting left of the dealer, each seat orders the up card (dealer: picks it up) or passes. When it is ordered, the dealer takes the up card and **discards one card face down**.
- **Round 2:** if all four pass, the up card is turned down. Each seat may name any other suit or pass. If all four pass again the hand is **passed out**: no points, and the deal passes left. There is no stick-the-dealer rule.
- **Play:** right bower (J of trump), left bower (J of the same colour, which counts as trump for following), then A K Q 10 9 of trump. You must follow the led *effective* suit. Left of the dealer leads the first trick, and each trick's winner leads the next.
- **Scoring:** makers take 3–4 tricks: 1 point. All 5 (march): 2. Fewer than 3 (euchred): 2 to the defenders. The page plays to 10 points.
- **Simplifications:** no going alone (skipped as not cheap: it adds a 3-player trick structure and a bid action), no misdeal or renege rules (illegal plays cannot be entered), and no table-talk conventions.

## Objective Walt optimizes

**Integer points for the hand, from team 0's side (South/North): +1 make, +2 march, −2 euchred, negated when the other side makes, 0 when passed out.** The game is zero-sum. Team 0 seats maximize and team 1 seats minimize the **sum over sampled deals** of this payoff. The h2h scores exactly this quantity. The score of the game to 10 is ignored: there is no situational play near the end of a game.

## Mapping onto the seven-function interface (plus one extension)

| card function | euchre (`engine.js`) |
|---|---|
| `to_move(public)` | `pub.turn`: auction seat, dealer for the discard, then trick order |
| `outcome(public)` | `outcome(pub)`: the integer team-0 payoff **as soon as it is fixed** by public trick counts (e.g. defenders already have 3), else `null`. Passed out returns 0. |
| `private(deal, seat, public)` | `privateOf`: unplayed cards held, plus the up card for the dealer during the discard. The dealer's own discard is packed in the high bits (it knows it). |
| `legal(private, public)` | pass/order; the 6 cards to discard; pass/3 suits; follow the effective suit |
| `play(public, action)` | `play(pub, a)`; for the hidden discard the action is **not** recorded |
| `sample(seat, private, public, n, rng)` | `sample`: exactly uniform over the hidden histories consistent with the seat's view (see below) |
| `maximizes(seat)` | `seat & 1 === 0` |
| *extension:* hidden action | `isHidden(pub)` (discard phase) and `applyHidden(deal, pub, a)` (rewrite the deal) |

**Bidding is played by Walt.** Order-up, pass and naming a suit are public actions, so they are ordinary `play`s. The root L1 decision at bid time searches the whole hand (auction, discard and 5 tricks). Each other seat's bid is a level-0 `decide` from its own chair: a best response to random play over its own sampled deals.

**The dealer's discard is a hidden action.** It is handled lawfully as follows:
- In `value()`, when the dealer is a modeled seat, its discard is chosen per deal by `decide`, run from its own holding (5 cards plus the up card) and the public record, with its own nested sample. Level 0 discards at random. Every deal is rewritten (`applyHidden`), but the **public successor is the same for every discard**. Nobody else's later decision can read the discard.
- When the decider is the dealer, it picks **one** discard for all its deals. Its holding is the same in every deal, so the card's `max` over options is unchanged.
- **Samplers** for other seats treat the discard like the deal itself. Every hidden history (original deal, discard) consistent with the record is equally likely. In practice this means:
  - The unplayed up card is in the dealer's hand or is the discard. The discard is a distinct 1-card slot, not merged with the 3 buried cards.
  - Those two cases get odds 5:1 (dealer hand slots : discard slot). That is exactly what a uniformly random discard implies, and `checks.mjs` measures 0.840 against 5/6.
  - The dealer's own sampler knows its discard.

Why this choice: the card's information rule allows a sampler to condition on what is lawful, never on inferences about a policy. Weighting the discard by a model of the dealer's policy would be such an inference. A known cost is that non-dealers give a 1/6 belief to "the dealer buried the up card (a trump)", which real dealers essentially never do. This is the documented "correct beliefs are not bought" weakness, not a rules violation.

**Other sampler constraints.** The sampler conditions on:
- the seat's own hand (and the dealer's own discard);
- played cards and per-seat hand sizes;
- voids revealed by failing to follow (by *effective* suit, so the left bower counts as trump);
- where the up card is: on the table, picked up, or turned down.

Uniform sampling uses the unconstrained proposal plus rejection against voids. After 64 straight rejections it switches to an exact counting DP over (card class × slot) tables with integer weights below 2^53. Both pieces are exactly uniform, so the mixture is too. DP and rejection marginals agree within sampling noise (`checks.mjs` item 2). All 95,940 sampled deals in the check were lawful.

## Walt implementation (`walt.js`)

`decide`/`value` follow the card: one action per information set for the decider across its sampled deals. Other seats are grouped by the action they take in each deal. A modeled seat decides one rung lower from its own holding with its own nested sample, and the bottom rung plays uniform random legal moves. All values are exact integer sums. Lawful levers used:

- **`n` / `n0` (/ `n1`):** worlds for the live decider, level-0 minds, and level-1 minds (L2 only).
- **Early exits:**
  - stop at the decider's turn once a move reaches the public payoff bound in every deal (the card's exit, generalized to integer payoffs);
  - `outcome` returns as soon as the hand's payoff is fixed by public trick counts.
- **Fail-soft (alpha, beta) window on the summed value.** At a grouping node the remaining groups are bounded by `len × [lo, hi]`. This prunes only subtrees that cannot change the decider's argmax. Checked exact: with a deterministic bottom rung, pruned and unpruned search made **187/187 identical decisions** (`checks.mjs` item 3) and visited 29% fewer nodes. With the random bottom rung the draws stay i.i.d., so the decision has the same distribution.
- **Noise:** each modeled seat's noise is seeded from (root nonce, seat, its holding, public record). This noise is independent of the deal, so a modeled seat plays one action per information set, never one per world. At L≥2, modeled decisions are cached per information set within a root decision.
- **Shipped settings:** the page and the h2h use **L1, n = 24, n0 = 8** ("Normal"). The page also offers Fast (n 12, n0 6) and Strong (n 40, n0 10).

### ms/move

These are non-forced decisions only. The machine is a shared 4-core container with other builders running, so treat the numbers as approximate.

| setting | where | bid/discard mean (max) | card play mean (max) |
|---|---|---|---|
| L1 n12 n0 6 (Fast) | Node `bench.mjs` | 109 ms (356) | 10 ms (55) |
| **L1 n24 n0 8 (Normal)** | Node `bench.mjs` | **305 ms (785)** | **31 ms (144)** |
| L1 n24 n0 8 | Node, during h2h (1,900 bid / 4,700 play moves) | 297–406 ms (1,711) | 32–47 ms (702) |
| L1 n40 n0 10 (Strong) | Node `bench.mjs` | 622 ms (1,542) | 64 ms (298) |
| **L1 n24 n0 8 (Normal)** | **headless Chromium, page worker** (134 / 371 moves) | **271 ms (783)** | **29 ms (238)** |
| L1 n12 n0 6 (Fast) | headless Chromium | 175 ms (454) | 22 ms (218) |
| L2 play (n12 n1 6 n0 8), L1 bids | Node, during h2h | ≈ L1 | 610–648 ms (4,445) |
| L2 everywhere (n12 n1 6 n0 6) | Node `bench.mjs` (5 bids) | ~8–10 s | ~1 s |
| PIMC n40 (baseline) | Node | 226 ms (582) | 7 ms (66) |

Normal stays under 1 s worst-case on this CPU, so a phone at 3–4× slower stays within a few seconds. L2 is affordable for card play (up to about 4 s) but not for the auction at these `n`.

## Baselines (`bots.js`)

- **random:** uniform legal action everywhere, including bids.
- **rule:** a standard heuristic bot.
  - *Hand strength:* trump R 12, L 10, A 8, K 7, Q 6, 10/9 5; off-suit A 5, K 2; +3 per off-suit void when holding at least 2 trumps.
  - *Ordering up:* threshold 25. The dealer counts the hand after its best discard. The dealer's partner adds half the up card's value and the opponents subtract it. Round 2 names the best other suit at 25 or more.
  - *Discard:* the card whose removal keeps the most strength (which creates voids).
  - *Play:* the maker side leads a boss trump. Otherwise lead an off ace. The maker's partner leads trump. Otherwise lead the low card of the shortest side suit. When following: duck if partner is winning, else win as cheaply as possible, else throw the cheapest card.
- **PIMC n = 40 ("pimc"):** samples 40 worlds with the *same lawful sampler* and solves each one exactly with alpha-beta minimax on the integer payoff. The solve covers the whole rest of the hand, **including the remaining auction and the discard**. It picks the action with the best summed value. At about 8 ms per play decision the solver is cheap.
- **PIMC-play ("pimc bid=1"):** rule-bot bidding with PIMC n = 40 for the discard and card play. It is included because perfect-information bidding is a known PIMC weak spot.

## H2H (duplicate)

Every deal is played twice on identical cards with the partnerships swapped. The dealer is deal index mod 4. "A net" sums A's hand points over both seatings, and the per-hand figure is half the per-deal mean. The 95% interval is mean ± 1.96·sd/√deals over per-deal duplicate scores. Seed 2026 is used for every match, so all matches share one deal set (deal *i* is the same everywhere).

| A vs B | deals (hands) | A net pts | **A points / hand, 95% CI** | deals A ahead / tied / behind | maker side A / B |
|---|---|---|---|---|---|
| rule vs random | 200 (400) | +388 | **+0.970 ± 0.115** | 168 / 24 / 8 | 91 / 309 |
| Walt L1 vs random | 50 (100) | +90 | **+0.900 ± 0.202** | 44 / 6 / 0 | 21 / 79 |
| PIMC vs rule | 200 (400) | +38 | **+0.095 ± 0.096** [−0.001, 0.191] | 51 / 112 / 37 | 229 / 171 |
| PIMC-play vs rule | 200 (400) | +49 | **+0.122 ± 0.069** [0.053, 0.192] | 31 / 157 / 12 | 200 / 200 |
| **Walt L1 vs rule** | 200 (400) | +6 | **+0.015 ± 0.092** [−0.077, 0.107] | 41 / 122 / 37 | 208 / 192 |
| **Walt L1 vs PIMC** | 150 (300) | 0 | **+0.000 ± 0.104** [−0.104, 0.104] | 27 / 96 / 27 | 127 / 173 |
| Walt L2-play vs Walt L1 | 60 (120) | −10 | **−0.083 ± 0.142** [−0.225, 0.059] | 3 / 48 / 9 | 60 / 60 |

Reading:
- **Walt L1 at n 24 / n0 8 is level with both standard baselines.** It is +0.015 against the rule bot and 0.000 against PIMC, with intervals of about ±0.1 points per hand.
- **It is not shown stronger than either one.** PIMC-play is the only entry that clears zero against the rule bot, by about 0.12 points per hand.
- **All the competent agents sit within roughly 0.1 points per hand of each other.** The auction and the 5-trick play leave little room at this resolution. Random is about 1 point per hand worse than any of them.
- **The two biddings are differently aggressive.** PIMC's perfect-information bidding is the most aggressive: it is the maker in 173 of 300 hands against Walt. Walt's ladder bidding is more conservative there but more aggressive than the rule bot (208 / 192).
- **L2 (card play only, at n 12) vs L1:** −0.08 ± 0.14 per hand over 60 deals. There is no evidence that the extra rung helps at this budget. It costs about 20× per play decision. As in 42 (L2 vs L1 tied), the measured height that is useful here is one rung. The comparison is confounded with `n` (12 vs 24), and bidding was L1 for both.

## Reproduce

```sh
cd /home/user/plunge
lab/euchre/run_all.sh                       # all matches above (~35 min CPU, single process)
node lab/euchre/summarize.mjs lab/euchre/results/*.jsonl
node lab/euchre/bench.mjs walt:level=1,n=24,n0=8 8   # ms/move
node lab/euchre/checks.mjs                  # sampler lawfulness/uniformity, pruning exactness
```

Single matches use the form `node lab/euchre/h2h.mjs --a SPEC --b SPEC --deals N [--start K] --seed 2026 --out file.jsonl`. Specs include `walt:level=1,n=24,n0=8`, `walt:level=2,bidLevel=1,bidN=24,n=12,n1=6,n0=8`, `pimc:n=40`, `pimc:n=40,bid=1`, `rule` and `random`. Each agent's decision seed is `hash(seed, deal, step, seat)`. It does not depend on the deal's hidden cards, and runs are deterministic. Per-deal records are in `results/*.jsonl`, and per-chunk wall time and ms/move are in `results/*.timing.txt`.

Page check: `python3 -m http.server` from `public/`, then open `/lab/euchre/` (`?quick` drops the animation pauses for automated runs). Two full games to 10 were played end to end in headless Chromium at 375 px width with a random-clicking human South: Normal 6–11, Fast 5–10. **Console errors: none.**

## Caveats

- **Light samples.** Each interval is about ±0.1 points per hand. Differences smaller than that (which is all of them among the competent agents) are unresolved. The rows share one deal set, so they are correlated with each other. Each row's own interval is valid.
- **The score is hand points, not game wins.** None of the agents knows the score of the game to 10.
- **Belief quality.**
  - Walt's modeled seats (and PIMC's samplers) do not infer anything from the auction. A partner's order-up says nothing to the sampler about trump length, which is lawful but uninformed.
  - Non-dealers give a 1/6 belief to "the dealer buried the up card" (see above).
- **The modeled minds are level-0 bidders:** best responses to random play. The L1 decider's forecast of how the others will bid is therefore crude. This is the ladder as specified, not a tuned bidding model.
- **The rule bot's thresholds were not tuned** (one plausible standard scheme). A stronger heuristic bidder could change the Walt vs rule row.
- **The L2 comparison is confounded:** L2 uses n 12 against L1's n 24, L2 is applied only in card play, and it covers 60 deals.
- **Timing ran on a shared, loaded 4-core container.** The browser figures come from headless Chromium on the same machine, not a real phone.
- **CPU budget:** about 35 min of h2h in total, slightly over the brief's 20–30 min aim, mostly because L2 cost more than planned.

## Verdict

**Practical.**
- **Rules fit:** euchre fits Walt cleanly. Every auction action is public. The one hidden action (the discard) fits through a small, lawful extension (`isHidden`/`applyHidden`) with uniform history sampling.
- **Cost:** the full L1 ladder over the *whole hand, auction included* costs about 0.3 s per bid and 0.03 s per card in the browser.
- **Strength:** at that budget Walt L1 plays even with PIMC with exact per-world solves and with a standard rule bot (both within ±0.1 points per hand). It is not demonstrably stronger.
- **Height:** L2 is affordable only for card play (up to about 4 s per move) and showed no gain in a light test.
