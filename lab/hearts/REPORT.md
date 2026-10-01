EXPLORATORY tier.

# Hearts: Walt experiment report

Page: `public/lab/hearts/` (served at `/lab/hearts/`). Harness and records: `lab/hearts/`.
Everything below is a probe record. Nothing in it is a proved or adjudicated claim.

## Verdict

**Practical, with caveats.** Walt fits Hearts' play phase cleanly and is cheap: about 30 ms per move on average, with a worst case under 1 s on desktop. It beats a classic rule-based bot by about 1.4 points per hand, both as the lone Walt (1v3) and as the lone bot among Walts (3v1). It also beats random play by a wide margin.

It is **not** stronger than a plain Monte Carlo player that uses rule-bot rollouts. Head to head it scores 0.63 points per hand worse (95% interval −1.27 to +0.01). In this game the ladder's random bottom rung makes the modeled opponents poor predictors of competent play. The ladder does add value over random-playout flat Monte Carlo, and a deeper horizon helps when the rollouts are random. It does not help when the rollouts come from a sensible policy.

The pass is a hidden action, so it is outside Walt's premise. It is handled by hold-hands h2h, sampler pins and a heuristic passer (below), not by search.

## Rules implemented

- 4 players, no partners, 52 cards, 13 tricks, play clockwise (S → W → N → E).
- The 2♣ leads trick one. Players must follow suit.
- No hearts and no Q♠ on trick one unless the hand holds nothing else.
- Hearts cannot be led until a heart has been played, unless the leader holds only hearts. The Q♠ does not break hearts.
- Points: each heart is 1 and the Q♠ is 13.
- **Shoot the moon:** a seat that takes all 26 points scores 0 and the other seats score 26 each.
- **Simplification (no effect on score):** a hand ends once every point card sits in a completed trick. The remaining tricks cannot change any score, so they are not played.
- **Web game:** passing rotates left, right, across, hold. The game runs to 100 points and the lowest total wins.
- **h2h:** hold hands (no pass) by default. One extra run passes with the heuristic passer in every seat.

### The pass

Passing three cards is a hidden action: only the receiver sees the cards. That breaks the card's premise that "the only hidden thing is the deal." It is handled in three ways:

1. **Walt does not search the pass.** Walt seats pass with a fixed heuristic, `rulePass` in `bots.js`. It is a function of the seat's own pre-pass hand, which is lawful.
2. **The post-pass hands are the "deal".** Each live decision samples deals consistent with the decider's hand, the public record, and **pins**. Pins are the cards the decider passed, which it knows sit in the receiver's hand until that seat plays them.
3. **Modeled seats sample without pins.** The decider cannot know what a modeled seat passed, so a modeled seat samples from its own chair with its hand and the public record only. That is lawful because the seat reads less than it is entitled to, never more. It is not optimal.

The headline h2h uses hold hands, so the comparison is free of this issue. One run with passing is reported separately.

## Mapping onto Walt's seven-function interface

| card function | Hearts implementation (`engine.js`) |
|---|---|
| `to_move(public)` | `pub[TOMOVE]` |
| `outcome(public)` | `isDone(pub)`: all 26 points are in completed tricks. The payoff is `payoff(pub, seat)`, an integer that includes the moon rule. |
| `private(deal, seat, public)` | `privateHand(deal, seat, pub)`: the seat's dealt suit masks minus the played cards. |
| `legal(private, public)` | `legalClasses`: legal cards reduced to equivalence classes. Same-suit cards are merged when every rank between them has left the game in a completed trick. The Q♠ is never merged. The reduction reads only the hand and the public record, and is exact. |
| `play(public, action)` | `play(pub, c)`: copies the state, applies the card, and resolves the trick. It also records lawful constraints that the play reveals (below). |
| `sample(seat, private, public, n, rng)` | `sampleDeals(seat, hand, pub, n, rng, pins)`: exactly uniform over consistent deals (below). |
| `maximizes(seat)` | Replaced by "every seat minimizes its own payoff" (below). |

**Public constraints.** The sampler respects the following, kept in `pub[ALLOW]`:

- Hand sizes.
- Voids, revealed by failing to follow suit.
- "Holds only hearts", revealed by leading a heart before hearts are broken.
- "Holds only point cards", revealed by playing a heart or the Q♠ on trick one.
- Pins (passed cards).

**Sampler.**

- If no other seat is constrained, the sampler deals the unknown cards with a plain shuffle.
- Otherwise it uses rejection sampling, up to 40 tries.
- If rejection fails, it switches to an exact count-and-draw. Cards are grouped by the set of seats allowed to hold them, and the completions of each split are counted with BigInt multinomials.

The draw is exact integer arithmetic with no floats. `selfcheck.mjs` checks every sampled deal against all the constraints, and checks the exact and rejection paths against each other: seat-by-suit marginals agree within 2.9% over 6,000 draws, which is within sampling noise.

**Objective.** Walt optimizes the following:

- For the deciding seat `s`, the value of a candidate card is **Σ over its sampled deals of `payoff_s`**.
- `payoff_s` is the points `s` took this hand. If any seat took all 26, the shooter scores 0 and every other seat scores 26.
- Walt **minimizes** this integer.
- Every modeled seat minimizes its own `payoff` in the same way, from its own chair, one rung lower.

The objective is therefore not zero-sum, and cumulative game standing (who is near 100) is ignored. Shooting the moon arises naturally from this objective. A seat that already holds many points sees a large drop in its own score by taking the rest. A seat facing a moon sees its own score jump to 26, so it is motivated to stop the shooter.

**Algorithm (`walt.js`).** The card's `decide`/`value` are followed line for line:

- One action per information set for the decider across its deals (a `min` over options of the summed value).
- Modeled seats are grouped by the action each one chooses in each deal, using `decide` from its own chair with its own nested sample of `n0` deals.
- The bottom rung (level 0) plays a uniformly random legal card.
- The live player is level 1.

The levers used are all lawful:

- **Horizon:** modeled minds and the decider's own chosen moves cover the next `h` plays. Beyond that, a cheap rollout finishes the hand: either a rule-bot policy or random. Every rollout seat acts on its own cards in that world.
- **Common random numbers:** the same RNG state is used for every candidate at a decision.
- **Early exit:** a move is accepted as soon as it reaches the public lower bound on the payoff. That bound is 0, or the points already taken once two seats hold points and a moon is impossible.

A decision reads only the decider's hand, the public record, its own pins, and a seed. The worker message carries exactly those.

## Settings and speed

Two Walt configurations were tested.

| name | settings | role |
|---|---|---|
| **Walt-R** | level 1, n = 48, n0 = 6, horizon 4 plays, rule-bot rollout | web default, headline |
| **Walt-D** | level 1, n = 24, n0 = 4, horizon 8 plays, random rollout | the card's "dice after", for comparison |

Speed of Walt-R:

| where | mean | other |
|---|---|---|
| Node, h2h | 30–32 ms/move | max 0.6–0.9 s |
| Chromium web worker | 32 ms/move | median 18, p95 99, max 345 ms (351 Walt moves, one full game to 100) |

Speed of Walt-D in Node: 39–51 ms/move, max 0.9 s.

All timings were taken on a shared 4-core box with load average about 6. On a phone, expect roughly 3–5× slower, which puts the worst case at about 1–3 s.

## Baselines

All baselines are in `bots.js`.

- **rule:** a classic heuristic bot.
  - Leads low from safe suits, avoiding suits nobody else can follow.
  - Flushes the Q♠ with low spades when it holds neither the queen nor A♠/K♠.
  - Never leads spades while holding the Q♠.
  - Ducks with its highest card under the current winner.
  - When last on a trick it must take, sheds its highest card, never winning with the Q♠.
  - When void, dumps the Q♠, then A♠/K♠ if the queen is still out, then its highest heart, then its highest card.
  - Against random play it scores 3.5 points per hand better.
- **random:** uniform legal card. This is the floor.
- **mc:n:** flat Monte Carlo. It samples n deals from its own chair, plays each candidate out randomly in every deal, and takes the lowest total. It uses the same sampler and common random numbers.
- **mcr:n:** the same Monte Carlo search, but the playouts use the rule bot. Against rule-bot opponents its playouts are an exact model of those opponents, apart from the hidden cards.
- **PIMC with an exact per-world solve was not run.** A 4-player perfect-information Hearts search (max-n to the end of the hand) costs far more than this budget allows, so mcr stands in as the strong sampling baseline.

## Head to head (duplicate)

**Format.** Every deal is played as a set of games with the seats rotated:

- **1v3:** one all-B game, then four games with A replacing B in seat 0, 1, 2 and 3. The B opponents are the same in every game.
- **3v1:** one all-A game, then four games with B replacing A in each seat.

The per-deal statistic is the mean over the four seats of (B's points − A's points) in the same chair on the same cards. A positive value means A takes fewer points. The interval is mean ± 1.96·sd/√deals, with the deal as the unit.

All runs use hold hands, seed 11, and the same deal sequence. Each starts from deal 0, so smaller runs use a prefix of the same deals.

### Main table

| A | B | mode | deals | B − A, points/hand [95%] | deals A better / worse / tied |
|---|---|---|---|---|---|
| Walt-R | rule | 1v3 | 100 | **+1.42** [+0.75, +2.08] | 72 / 24 / 4 |
| Walt-R | rule | 3v1 | 36 | **+1.43** [+0.17, +2.70] | 26 / 10 / 0 |
| Walt-R | random | 1v3 | 50 | **+3.57** [+2.86, +4.28] | 46 / 4 / 0 |
| Walt-R | mcr:200 | 1v3 | 100 | **−0.63** [−1.27, +0.01] | 36 / 55 / 9 |
| Walt-D | rule | 1v3 | 60 | +0.47 [−0.23, +1.18] | 29 / 28 / 3 |
| Walt-D | mc:24 | 1v3 | 60 | +0.68 [−0.17, +1.53] | 30 / 26 / 4 |
| Walt-R | rule | 1v3, **with passing** | 50 | +0.64 [−0.08, +1.36] | 29 / 15 / 6 |

### Reference baselines (same deals)

| A | B | mode | deals | B − A [95%] |
|---|---|---|---|---|
| rule | random | 1v3 | 50 | +3.51 [+2.91, +4.10] |
| mc:24 | random | 1v3 | 50 | +3.19 [+2.41, +3.96] |
| mc:200 | random | 1v3 | 50 | +3.72 [+3.11, +4.32] |
| mcr:48 | random | 1v3 | 50 | +3.99 [+3.41, +4.57] |
| mcr:200 | random | 1v3 | 50 | +4.28 [+3.75, +4.80] |
| mc:24 | rule | 1v3 | 100 | −0.71 [−1.38, −0.04] |
| mc:200 | rule | 1v3 | 100 | −0.46 [−1.18, +0.26] |
| mcr:48 | rule | 1v3 | 100 | +2.32 [+1.67, +2.96] |
| mcr:200 | rule | 1v3 | 100 | +2.59 [+1.98, +3.19] |
| mcr:200 | rule | 3v1 | 36 | +2.04 [+0.71, +3.36] |
| mcr:200 | rule | 1v3, with passing | 50 | +1.55 [+0.82, +2.27] |

### Tuning sweep

These runs used seed 2, 100 deals, A = Walt against B = rule in 1v3, with n = 24 and n0 = 4 unless noted. They are tuning only; the deals differ from the tables above.

| rollout | horizon 1 | horizon 2 | horizon 4 | horizon 6 | horizon 8 |
|---|---|---|---|---|---|
| rule bot | +1.72 [1.10, 2.34] | +1.42 [0.89, 1.94] | +1.01 [0.33, 1.68] | +0.61 [−0.05, 1.27] | — |
| random | (= flat MC: −0.86 [−1.47, −0.26]) | — | +0.21 [−0.40, 0.82] | — | +0.83 [0.20, 1.46] |

Two related runs on the same deals:

- Walt with n = 48, n0 = 6, horizon 4 and rule rollout (the Walt-R settings): +1.18 [0.55, 1.81].
- mcr:200: +2.29 [1.79, 2.80].

Horizon 1 means the decider's own move followed by an immediate rollout, so no modeled minds are involved. With rule rollouts, horizon 1 is exactly mcr:24.

### Reading

1. **Walt-R is a clear improvement over the rule bot.** It gains about 1.4 points per hand, and the margin holds both as the lone Walt (1v3) and as three Walts against one bot (3v1). It is far above the random floor.
2. **With random playouts, the ladder beats flat Monte Carlo.** At matched n = 24, Walt-D is 1.2–1.7 points per hand better than flat MC indirectly, measured through the rule bot on the same deals (+0.47 vs −0.71 here; +0.83 vs −0.86 in the sweep). The direct duplicate is +0.68 [−0.17, +1.53]. A deeper horizon helps (+0.21 at horizon 4, +0.83 at horizon 8). This is the card's claim, and it holds: choosing one's own later moves and modeling opponents is better than random playouts.
3. **With a good rollout policy, the ladder hurts.** Against rule bots, every extra ply of modeled minds lowers the score, from +1.72 at horizon 1 to +0.61 at horizon 6. Head to head, mcr:200 edges Walt-R.

   The likely mechanism is the model, not the cost. A level-0 mind is a best response to random opponents. Random Hearts opponents dump points almost arbitrarily, so a level-0 mind predicts competent opponents worse than a sensible heuristic does.

   Level 2 (opponents modeled at level 1) would test this directly but was not run. It costs roughly n0 times more per modeled decision.
4. **Passing narrows the edge.** With passing, Walt-R's edge drops to +0.64 [−0.08, +1.36]; mcr's drops too, from +2.59 to +1.55. Two plausible causes: the heuristic passer gives the rule bot better hands, and Walt's modeled seats ignore their own pass knowledge. This run is small, and neither cause was isolated.

## Reproduce

Run from `lab/hearts/`. Everything is single-process and deterministic for a given seed; timings vary with load.

```sh
node selfcheck.mjs                      # rules/sampler invariants + exact-vs-rejection sampler check
W=walt:n=48,n0=6,h=4,r=rule; D=walt:n=24,n0=4,h=8,r=random
node h2h.mjs --a $W --b rule      --deals 100 --seed 11
node h2h.mjs --a $W --b rule      --deals 36  --seed 11 --mode 3v1
node h2h.mjs --a $W --b random    --deals 50  --seed 11
node h2h.mjs --a $W --b mcr:n=200 --deals 100 --seed 11
node h2h.mjs --a $D --b rule      --deals 60  --seed 11
node h2h.mjs --a $D --b mc:n=24   --deals 60  --seed 11
node h2h.mjs --a $W --b rule      --deals 50  --seed 11 --pass 1
# references: --a rule|mc:n=24|mc:n=200|mcr:n=48|mcr:n=200 against --b random (50) / rule (100)
# tuning sweep: --seed 2 --deals 100 --a walt:h=1|2|4|6[,r=random] --b rule
# add --verbose for per-deal lines, --json for the full record
```

Raw output of the final runs: `lab/hearts/results.txt`.

Browser end-to-end check: serve `public/` with `python3 -m http.server 8765`, then run

```sh
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node e2e.mjs
```

It loads `/lab/hearts/?fast` at phone width (390×844). `?fast` only removes the animation pauses. The script passes, then plays South with the first legal card each turn until someone reaches 100. Two complete games (8 and 9 hands) were played, with **0 console errors**. The Walt timings in the speed table come from the second game.

## Caveats

- **The sample is small.** Several intervals touch 0, and the 3v1 and passing runs use only 36–50 deals.
- **The rule bot does not try to shoot the moon or to stop a moon.** Moons still occur, by accident and from Walt.
- **mcr:200 against the rule bot has a model advantage.** Its rollouts are the opponents' own policy. The direct Walt-R vs mcr match removes that advantage, and Walt-R still scores slightly lower.
- **Walt-R's rollout is not the card's "dice after".** Beyond the horizon it uses the rule-bot policy, a cheap rollout the brief allows. Walt-D is the card-faithful variant. Below the horizon, the bottom rung is always random legal, as the card requires.
- **The objective ignores cumulative standing.** It is the seat's own points for the hand, with the moon rule. A real match player near 100 would weigh relative scores.
- **Modeled seats ignore their own pass knowledge.** This is lawful, but it is weaker than what a real seat would use. Walt also does not search the pass.
- **Timing noise.** Timings come from a shared, loaded 4-core machine; ms/move is indicative only.

## Files

- `public/lab/hearts/`
  - `index.html`, `main.js`: the UI. You are South against three Walt seats; the page shows scores, hearts broken and the last trick, and plays to 100.
  - `worker.js`: Walt in a module Web Worker.
  - `engine.js`: rules, public state, sampler and RNG.
  - `walt.js`: decide/value.
  - `bots.js`: rule bot, flat MC, MC-rule, the rollouts and the passer.
- `lab/hearts/`
  - `h2h.mjs`: duplicate harness, importing the same engine modules.
  - `selfcheck.mjs`: invariant checks.
  - `e2e.mjs`: Playwright end-to-end check.
  - `results.txt`: raw output of the final runs.
  - `REPORT.md`: this report.

## Rerun: Walt with 4× root samples (n = 192)

EXPLORATORY tier. Probe record only; not a result, not adjudicated.

Only the root deal count changed: n 48 → 192, with n0=6, h=4, r=rule unchanged. Same seed (11), same hold-hands deals 0–99, 1v3. The shipped page keeps n = 48.

```sh
# from lab/hearts/ ; run in chunks with --first because one 100-deal run exceeds ~9 min
W4=walt:n=192,n0=6,h=4,r=rule
node h2h.mjs --a $W4 --b mcr:n=200 --deals 25 --first 0  --seed 11 --verbose
node h2h.mjs --a $W4 --b mcr:n=200 --deals 50 --first 25 --seed 11 --verbose
node h2h.mjs --a $W4 --b mcr:n=200 --deals 25 --first 75 --seed 11 --verbose
node h2h.mjs --a $W4 --b rule      --deals 50 --first 0  --seed 11 --verbose
node h2h.mjs --a $W4 --b rule      --deals 50 --first 50 --seed 11 --verbose
# equivalent single run: node h2h.mjs --a $W4 --b mcr:n=200 --deals 100 --seed 11
```

Chunks are merged from the per-deal deltas (`--verbose`) with the harness's own formula (deal-level mean ± 1.96·sd/√n). Raw output: `lab/hearts/results-n192.txt`. ms/move at n=192 is the deal-weighted mean of the chunk summaries (approximate; shared box, load ~6–7).

| A | B | n | B − A, points/hand [95%] | deals A better / worse / tied | Walt ms/move (max) |
|---|---|---|---|---|---|
| Walt-R | mcr:200 | 48 | −0.63 [−1.27, +0.01] | 36 / 55 / 9 | 30.3 (868) |
| Walt-R | mcr:200 | **192** | **−0.08 [−0.73, +0.57]** | 40 / 51 / 9 | ~109 (2385) |
| Walt-R | rule | 48 | +1.42 [+0.75, +2.08] | 72 / 24 / 4 | 32.3 (604) |
| Walt-R | rule | **192** | **+1.98 [+1.34, +2.61]** | 81 / 16 / 3 | ~122 (1792) |

Walt moves took about 3.6–3.8× longer at n=192, roughly tracking the 4× sample count; the worst single move reached 2.4 s in Node under load. Against mcr:200 the point estimate moved from −0.63 to −0.08 (now near parity, interval spans 0); against the rule bot from +1.42 to +1.98. Both changes are within sampling noise on 100 shared deals (the rows are not independent paired n=48-vs-n=192 comparisons). The data are consistent with part of the n=48 gap to mcr:200 being root-sampling noise, but they do not show Walt-R overtaking mcr:200, and they do not test the model-of-opponents explanation in the Reading section.
