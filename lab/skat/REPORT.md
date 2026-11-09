EXPLORATORY tier.

# Skat (play phase) — Walt lab report

Page: `/lab/skat/` (`public/lab/skat/`: `skat.js` rules, setup, sampler and bots; `walt.js` the ladder; `pimc.js` the PIMC + double-dummy baseline; `worker.js`; `app.js`; `index.html`). Harness: `lab/skat/h2h.mjs` (duplicate h2h) and `lab/skat/bench.mjs` (ms/move). Both import the same engine modules the page uses. Raw per-deal rows are in `lab/skat/results/*.jsonl`.

## Rules variant implemented
- Standard Skat card play: 3 seats, 32 cards (7 8 9 10 J Q K A in ♣ ♠ ♥ ♦), 10 cards each plus a 2-card skat. Card points A 11, 10 10, K 4, Q 3, J 2, others 0 (120 total).
- Suit game: trumps are ♣J > ♠J > ♥J > ♦J, then A 10 K Q 9 8 7 of the trump suit (11 trumps). Grand: only the four jacks are trumps. Plain suits rank A 10 K Q 9 8 7. You must follow the led suit (jacks count as trump, not as their printed suit); otherwise you may play any card. Forehand (seat 0) leads trick 1; the trick winner leads next.
- The declarer gets the points of the 2 discarded cards at the end. **Win = declarer has at least 61 card points** (tricks plus discard). That is the whole objective. Schneider, schwarz, game value and overbidding are ignored.
- **Simplifications:**
  - No auction. The page uses "strongest hand declares": the highest heuristic `handScore` over the five games. The h2h uses `rotate`, where the declarer is seat `seed mod 3` and is forced to play its best game. Under "strongest", rule bots make about 85% of games and random play makes 75%, so most deals would carry no signal. Under `rotate`, rule bots make about 61%, which leaves far more deals contested.
  - The declarer picks up the skat. Game type and discard come from one deterministic heuristic: the max over 5 games × 66 discards of `handScore(kept 10) + points(discard)`, with a penalty for discarding trumps. On the page a human declarer chooses both, with the heuristic's suggestion pre-selected.
  - No null games. No hand games or ouvert.
  - Hidden action: the discard. The declarer knows its 2 discarded cards. Defenders' samplers treat the skat as 2 unknown cards.

## Mapping onto Walt's seven functions
| card function | Skat implementation |
|---|---|
| `to_move(public)` | `pub.turn` |
| `outcome` | `outcomeDeal(pub, skatPoints(deal))`. **The score reads the hidden skat, so outcome takes the deal.** Returns true when `declPts + skat ≥ 61`, false when `defPts ≥ 60` or all 30 cards are played, otherwise null. This early resolution is exact because points only accumulate. |
| `private(deal, seat, public)` | `privateOf`: the seat's cards not yet played. For the declarer seat it also returns its discard. |
| `legal(private, public)` | `legalList`: follow the led effective suit if possible. |
| `play(public, a)` | `play`: immutable public state. It records each seat's revealed voids (by effective suit) and the trick points per side. |
| `sample(seat, private, public, n, rng)` | `sampleDeals`: **exactly uniform** over all deals consistent with the seat's view: hand sizes, revealed voids, and the declarer's discard if the seat is declarer. A defender sees partner hand + declarer hand + 2-card skat as unknown, and the skat has no void constraints. The sampler counts exactly with a DP over effective-suit groups (integers below 2^53) and then samples per group. |
| `maximizes(seat)` | `seat === declarer`. The declarer maximises the count of made deals. Each defender minimises it. |

**Objective Walt optimises:** the binary "declarer reaches 61". `value` returns the exact integer count of the decider's sampled deals in which the declarer makes it. It is `sum(outcome(d, public) for d in deals)`, the card's "outcome takes the deal" case. Card points are never maximised for their own sake.

`decide`/`value` follow the card:
- The decider's `max`/`min` is taken once over its group of deals, at the root and at its own later turns.
- Every other seat (including a defender's partner) decides from its own chair. Its `private` comes from that deal, and it draws its own nested sample of `n0` worlds.
- Level 0 picks a uniformly random legal card.
- The live player is level 1.
- Early exits at the decider's own turns: stop once a move makes every deal (declarer) or none (defender).
- Random choices use common random numbers. They are keyed by (decide-level salt, deal index, ply), never by deal contents.

Added levers, all lawful under the card:
- **Horizon.** The live rung searches `horizon[1] = 6` plies with minds, and modeled level-0 minds search `horizon[0] = 3` plies. Past the horizon, each deal is played out by a cheap lawful rollout policy, the rule bot (each seat reads only its own hand + public record). `rollout: 'random'` (dice) is also implemented.
- **Endgame.** When at most `endgame = 15` plies (5 tricks) remain, the live rung searches to the end with no horizon.
- **Tie order.** Options are tried in a deal-independent preference order: the rule bot's card first, then cheaper cards. `max`/`min` keeps the first best, so exact ties go to the rule bot's choice. This reads only the decider's hand + public. PIMC uses the identical tie order. Pilot (exploratory, seed 1): this one change moved Walt-vs-rule from +0.05 (40 deals) to +0.25 (60 deals). Binary objectives tie constantly, and the default "first card by index" tie order throws away points.

## Walt settings and ms/move
| config | n | n0 | horizon [minds, live] | endgame | rollout |
|---|---|---|---|---|---|
| **std** (page default, used in all h2h) | 32 | 6 | [3, 6] | 15 plies | rule |
| fast (page option) | 16 | 4 | [3, 5] | 12 plies | rule |

These are Node 22 numbers on this shared 4-core box with six builders running. `node lab/skat/bench.mjs std 20` uses "strongest declares" deals, Walt in all seats, 600 moves:
- **std:** mean 69 ms, median 8 ms, p95 385 ms, p99 690 ms, max 1.22 s. The first three tricks are the expensive ones: trick 1 averages 248 ms with a 1.2 s max.
- **fast:** mean 15 ms, p95 78 ms, max 268 ms.
- **In the h2h (`rotate` deals, contended CPU):** std averaged 137 ms/move with a 4.9 s worst move over 3000 moves. Weak forced declarers make fewer early exits.

In headless Chromium (Playwright, same box), the page measured a highest reported Walt move of 920 ms across 3 complete games. On a phone, expect "std" around 2–4× slower: typically well under a second, with rare early-trick moves of a few seconds. "fast" exists for slow phones.

## Baselines
- **PIMC(n=20)** with an exact double-dummy solve per sampled world. Worlds come from the same exact sampler, from PIMC's own chair. For every candidate card, each world is solved exactly to decide whether the declarer reaches 61. The solver is a null-window alpha-beta over declarer card points, with a transposition table at trick starts (bounds shared across candidate moves within a world) and equivalent-card pruning (adjacent live cards with equal points). It was checked against brute-force minimax on 300 endgames (≤ 5 tricks): 0 mismatches. PIMC picks the card that wins in the most worlds (declarer) or the fewest (defender), with the same tie order as Walt.
  - Full 30-card solves take 45 ms on average, with a heavy tail (up to ~0.4 s).
  - In the h2h, PIMC averaged 103 ms/move, max 21.6 s. On average it is roughly compute-matched with Walt std (137 ms).
- **rule:** a lawful heuristic bot. Declarer draws trumps with top trumps and cashes side aces. Defenders cash aces and lead side suits. Followers smear points on a partner's winning trick, win cheaply when last, and otherwise play low.
- **random:** uniform legal card.

## Head-to-head (duplicate)
Each deal is played twice on identical cards:
- **Table 1:** A declares against two B defenders.
- **Table 2:** B declares against two A defenders.

Per-deal score = [A-declarer made] − [B-declarer made], in {−1, 0, 1}. The tables report the mean with a normal 95% interval. All final runs use `--seed 2` (fresh deals, never used in tuning) and `--decl rotate`.

| A | B | deals | A-decl made | B-decl made | both / neither / A-only / B-only | mean diff (A − B) | 95% CI |
|---|---|---|---|---|---|---|---|
| **Walt std** | **PIMC(n=20)** | 100 | 55 | 59 | 47 / 33 / 8 / 12 | **−0.040** | [−0.128, +0.048] |
| Walt std | rule | 60 | 41 | 28 | 26 / 17 / 15 / 2 | +0.217 | [+0.093, +0.341] |
| PIMC(n=20) | rule | 60 | 42 | 25 | 23 / 16 / 19 / 2 | +0.283 | [+0.151, +0.416] |
| Walt std | random | 30 | 27 | 4 | 4 / 3 / 23 / 0 | +0.767 | [+0.613, +0.921] |
| rule | random | 60 | 44 | 18 | 17 / 15 / 27 / 1 | +0.433 | [+0.299, +0.568] |

These runs share seeds, so the 60-deal rows play the first 60 deals of the 100-deal row.

Headline: **Walt (std) and PIMC with exact double-dummy solving are statistically indistinguishable** on 100 duplicate deals. The point estimate favours PIMC by 4 points of make-rate, CI [−0.13, +0.05]. Both clearly beat the rule bot, and PIMC's margin over rule is nominally larger. Walt-std reached that level for about the same average time per move.

Tuning pilots (exploratory, `--seed 1`, deals 0–59; not part of the result):

| Walt config vs PIMC(n=20) | ms/move | mean diff | 95% CI |
|---|---|---|---|
| fast | 22 | −0.150 | [−0.262, −0.038] |
| std | 100 | +0.050 | [−0.059, +0.159] |

The budget lever therefore matters, and the ladder scales with n/n0/horizon.

### Reproduce
```sh
# from the repo root; each command appends to its .jsonl (delete it first for a clean run)
node lab/skat/h2h.mjs --a 'walt:{"n":32,"n0":6,"horizon":[3,6],"endgame":15}' --b pimc:20 --seed 2 --from 0 --to 100 --out lab/skat/results/walt-vs-pimc.jsonl
node lab/skat/h2h.mjs --a 'walt:{"n":32,"n0":6,"horizon":[3,6],"endgame":15}' --b rule   --seed 2 --from 0 --to 60  --out lab/skat/results/walt-vs-rule.jsonl
node lab/skat/h2h.mjs --a pimc:20 --b rule   --seed 2 --from 0 --to 60 --out lab/skat/results/pimc-vs-rule.jsonl
node lab/skat/h2h.mjs --a 'walt:{"n":32,"n0":6,"horizon":[3,6],"endgame":15}' --b random --seed 2 --from 0 --to 30 --out lab/skat/results/walt-vs-random.jsonl
node lab/skat/h2h.mjs --a rule --b random --seed 2 --from 0 --to 60 --out lab/skat/results/rule-vs-random.jsonl
node lab/skat/h2h.mjs --summary lab/skat/results/walt-vs-pimc.jsonl     # table row + timing
node lab/skat/bench.mjs std 20 ; node lab/skat/bench.mjs fast 20         # ms/move
```
Walt vs PIMC took about 12 min wall (run as two 50-deal chunks, `--from 0 --to 50` and `--from 50 --to 100`). The other rows took about 7 min together. Results are deterministic given the seeds. Timings vary.

## Caveats
- **The rollout and tie order borrow the rule bot.** Past the horizon, Walt's values come from rule-bot playouts. The rule bot's quality is part of Walt's strength here: the pilot with dice rollouts was about the same against rule, but it was not run against PIMC. PIMC gets the same tie order but solves exactly, so it borrows nothing else.
- **Horizon.** The live rung does not see past 6 plies with minds until the last 5 tricks. Modeled minds see 3 plies. A full-depth live search (`endgame: 30`) was affordable on average but had a 65 s worst move, and it was *not* stronger in a 40-deal pilot against rule (−0.03).
- **Beliefs are lawful-only, as the card says.** The declarer is chosen by a deal-dependent rule, and the discard by a heuristic. Neither Walt nor PIMC conditions on that: the declarer's hand is sampled uniformly subject to sizes and voids. The same goes for inferences about play.
- **Small samples at depth.** When a group of deals shrinks to one world deep in the tree, the decider's choice there is effectively clairvoyant for that world. This is inherent in the card's algorithm at finite n, not a violation of the information rule.
- **Statistics.** The interval is a normal approximation on per-deal differences. 100 deals only resolves differences of about ±0.09. Only 20 of the 100 Walt-vs-PIMC deals were split.
- **The objective is binary only.** PIMC optimises the same binary target, not expected points (the usual Skat-AI choice), so it may differ from a points-PIMC.
- **No auction and no null.** The results are for card play given a fixed contract.

## Verdict
**Practical, with caveats.** Skat's play phase fits Walt's interface cleanly:
- The only hidden action is the discard, which is part of the declarer's private holding.
- The skat-dependent score is handled by letting `outcome` take the deal.
- The exact uniform sampler handles voids and the unknown skat.

The full level-1 ladder does not fit in a phone budget at full depth, so the result depends on a horizon (6 plies live, 3 for modeled minds) with a cheap lawful rollout, plus an endgame full search. With those, Walt runs at about 70–140 ms/move on average (worst moves ~1–5 s in Node). Under that budget it plays level with PIMC with exact double-dummy solving on duplicate deals: −0.04, CI [−0.13, +0.05]. Both beat a rule bot by about +0.2–0.3.

## Rerun: Walt with 4× root samples (n = 128)

EXPLORATORY tier. Same harness, seed, deals and PIMC baseline as the n = 32 row above. Only Walt's root sample count `n` changed (32 to 128); `n0`, horizon and endgame are unchanged. The shipped page keeps "std" (n = 32).

**Commands** (repo root, single process, foreground, 6 chunks, about 33.5 min wall in total):
```sh
A='walt:{"n":128,"n0":6,"horizon":[3,6],"endgame":15}'
node lab/skat/h2h.mjs --a "$A" --b pimc:20 --seed 2 --from 0  --to 5   --out lab/skat/results/walt128-vs-pimc.jsonl
node lab/skat/h2h.mjs --a "$A" --b pimc:20 --seed 2 --from 5  --to 25  --out lab/skat/results/walt128-vs-pimc.jsonl
node lab/skat/h2h.mjs --a "$A" --b pimc:20 --seed 2 --from 25 --to 45  --out lab/skat/results/walt128-vs-pimc.jsonl
node lab/skat/h2h.mjs --a "$A" --b pimc:20 --seed 2 --from 45 --to 67  --out lab/skat/results/walt128-vs-pimc.jsonl
node lab/skat/h2h.mjs --a "$A" --b pimc:20 --seed 2 --from 67 --to 87  --out lab/skat/results/walt128-vs-pimc.jsonl
node lab/skat/h2h.mjs --a "$A" --b pimc:20 --seed 2 --from 87 --to 100 --out lab/skat/results/walt128-vs-pimc.jsonl
node lab/skat/h2h.mjs --summary lab/skat/results/walt128-vs-pimc.jsonl
```

| Walt config (A) vs PIMC(n=20) | deals | A-decl made | B-decl made | both / neither / A-only / B-only | mean diff (A − B) | 95% CI | Walt ms/move mean / max | PIMC ms/move mean / max |
|---|---|---|---|---|---|---|---|---|
| std, n = 32 (`walt-vs-pimc.jsonl`) | 100 | 55 | 59 | 47 / 33 / 8 / 12 | −0.040 | [−0.128, +0.048] | 136.7 / 4,889 | 102.6 / 21,632 |
| n = 128 (`walt128-vs-pimc.jsonl`) | 100 | 57 | 58 | 48 / 33 / 9 / 10 | −0.010 | [−0.096, +0.076] | 579.9 / 16,558 | 89.0 / 19,509 |

Each ms/move figure is over 3000 moves on the shared 4-core box.

**What changed.** Walt's mean cost per move rose about 4.2× (137 → 580 ms) and its worst move about 3.4× (4.9 s → 16.6 s). The point estimate moved from −0.040 to −0.010 (A-only/B-only 8/12 → 9/10). The CI is still about ±0.09 wide and contains both 0 and the old estimate, so the two configurations cannot be separated on these 100 deals. Individual games did change (16 A-declarer and 17 B-declarer outcomes flipped; 21 per-deal duplicate scores changed), but the flips roughly cancelled. There is no evidence that 4× root samples improves Walt against PIMC(n=20) at this horizon/endgame setting, and n = 128 is no longer compute-matched: Walt now uses about 6.5× PIMC's mean ms/move (n = 32 was about 1.3×), and a 16.6 s worst move is outside the phone budget.
