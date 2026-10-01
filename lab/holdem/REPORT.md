EXPLORATORY tier.

# Walt at heads-up limit Texas hold'em

**Verdict: Walt in its card form doesn't work as a poker player.** It fits the game
and runs fast enough, so the engine itself is fine. Its play is the problem. At every
ladder level and horizon I could afford, it loses to a simple equity-threshold rule
bot. The page is: `public/lab/holdem/` (human vs Walt). There are two structural
reasons, and both are measured below:

1. **Its beliefs ignore bets.** Walt samples the opponent's hole cards uniformly from
   the unseen cards, because the card allows only lawful constraints. In 42 the lawful
   constraints carry most of the information. In poker, bets are the main information
   channel, and Walt reads nothing from them. A raise is treated as coming from a
   random hand.
2. **It plays a pure policy on top of a random bottom rung.** A best response to random
   play turns into a maniac (random opponents fold a third of the time), so level 1
   models its opponent as a maniac. As a result, level 1 calls down light, value-bets,
   and almost never bluffs. In Leduc hold'em, where exploitability can be computed
   exactly, raising the ladder gets Walt to a head-to-head tie with an approximate Nash
   strategy at level 3. But it stays very exploitable (0.50 chips/hand, against ~0 for
   CFR).

## Rules implemented

- **Variant:** heads-up **fixed-limit** hold'em.
  - Blinds 1/2. The small bet is 2 (preflop and flop) and the big bet is 4 (turn and
    river).
  - Each street is capped at 4 bets, and the big blind counts as the first preflop bet.
  - Seat 0 is the button and posts the small blind. It acts first preflop and last
    after the flop.
  - Fold is legal only when facing a bet. This matches OpenSpiel.
- **Hands are independent.** Both players always cover the maximum 48-chip hand, so
  no-limit and all-in situations never arise. On the page, each player starts with 200
  chips and the button alternates. The match ends when a stack drops below 48.
- **Oracle checks:**
  - `lab/holdem/evalcheck.mjs` enumerates all C(52,7) hands. The category counts
    match the textbook values exactly, and there are 7,462 distinct 5-card classes.
  - `oracle_check.py` compares showdowns against **pokerkit**: 20,000 random deals,
    0 mismatches.
  - `oracle_rules.py` replays random hands in **OpenSpiel `universal_poker`** (ACPC
    limit gamedef) and compares the actor, the legal-action set at every decision, and
    the final payoffs: 5,000 + 3,000 hands, 0 mismatches.

## Mapping onto Walt's interface

Code: `public/lab/holdem/game.js` (the game) and `walt.js` (the card's `decide` /
`value`, written generically). The same modules run in the worker and in the Node
harness.

| card function | hold'em |
|---|---|
| `to_move(public)` | `pub.actor` |
| `outcome(public)` | terminal on a fold or after the river closes; **payoff takes the deal**: net chips for the seat (folds don't read the deal; a showdown reads both hands) |
| `private(deal, seat, public)` | the seat's two hole cards plus the board visible at `pub.street` |
| `legal(private, public)` | fold / check-call / bet-raise, read from the public record only |
| `play(public, a)` | the betting state machine; closing a street sets `fresh` and advances `street` |
| `sample(seat, private, public, n, rng)` | the opponent's hole cards and the future board, uniform over unseen cards (structured, see below) |
| `maximizes(seat)` | every seat maximizes its own chips (zero-sum) |

**Objective Walt optimizes:** its own **net chips for the hand, summed over its
sampled deals** (an exact integer, so in effect expected chips). It does not optimize
win probability.

Two generalizations were needed. Both stay inside the information rule.

- **Chance reveals.** Board cards are part of the deal, and they are revealed when a
  street closes. Once the flop or turn has come, deals with different boards are
  different information sets for everyone. So `value` splits the decider's deals by
  visible board at every street change, and takes its `max` separately within each
  group.
- **Structured sampling.** With i.i.d. deals, every sampled flop would sit in a
  singleton group. Walt's later decisions would then see exactly one opponent hand,
  which is strategy fusion in effect. So `sample` draws a tree:
  - each future street within the horizon branches `branch` ways;
  - each leaf draws the opponent's hole cards and the rest of the board.

  Each later information set then holds `n / branch^k` deals with different opponent
  hands.

Other parts follow the card directly:

- **Modeled seats** decide from their own chair, using a nested sample built from their
  own hole cards and the visible board. Their decisions are memoized per information
  set (hole cards, board, betting record) within one root decision.
- **The bottom rung** plays a uniformly random legal action.
- **Beyond the horizon** the hand is checked down to showdown. This is the "cheap
  rollout" lever. A random rollout would be meaningless in poker because of random
  folds.
- **Exact integers:**
  - Values are integer chip sums.
  - The PRNG (sfc32, rejection-sampled) is integer-only.
  - The rule bot's equity is an integer count.
  - The page converts values to per-deal decimals only for display, and the harness
    uses floats only for its statistics.

## Walt settings and speed

The live player is **level 1** (the card's live player: a best response to level-0
minds, which are best responses to random play), set in `public/lab/holdem/config.js`:

- `n = 128` root deals, `horizon = 1` (this street and the next with minds, then
  check-down), `branch = 8`
- modeled minds: `n0 = 32`, `horizon0 = 0` (their current street, then check-down)

**ms/move, Node 22 on this machine** (4 cores shared with five other builders), over
200 random decision points (`results/timing.txt`):

| | median ms | p90 ms | max ms |
|---|---|---|---|
| preflop | 135 | 232 | 261 |
| flop | 153 | 379 | 587 |
| turn | 129 | 323 | 393 |
| river | 18 | 56 | 195 |
| **all** | **105** | **285** | **587** |

- One isolated 7.1 s spike appeared in the L1-vs-L0 match. Replaying the same moves
  gave a 513 ms maximum, so it was load or GC.
- **In Chromium** (Playwright, page worker), the median was 76–146 ms and the max 301–642
  ms across the runs.
- **Phone:** the CPU-throttle emulation did not slow the worker, so the phone figure is
  an estimate. Assuming a phone is 3–5× slower, expect ~0.3–0.7 s median and ~2–3 s
  worst case. That is within the brief's "few seconds".
- **Cost driver:** each root decision spawns 500–4,000 modeled level-0 minds.

## Baselines

All are in `lab/holdem/bots.mjs`.

- **random:** a uniform legal action (the floor).
- **station:** always check or call.
- **equity:** a rule-based equity-threshold bot.
  - It computes equity against one random hand: an exact enumeration on the river,
    and 300 Monte Carlo samples before that.
  - It bets at ≥58%, raises at ≥66%, calls at ≥40%, and otherwise checks or folds.
- **exploiter:** the same bot retuned against Walt's measured leaks: bet ≥50% (thin
  value), raise ≥60%, call only ≥60%.
- **flatMC:** flat Monte Carlo. For each action it samples 200 worlds from its own
  chair, finishes the hand with random play on both sides, and takes the best chip sum.
  This is the brief's canonical ablation of Walt.

**OpenSpiel** installed from PyPI (open-spiel 2.0.2). I used it as a rules oracle and
for the exact Leduc study. CFR on full HULHE is out of reach, and I found no published
pre-solved limit strategy on PyPI or npm (Cepheus's is far too large), so there is no
"strong standard" hold'em opponent.

## Head-to-head (duplicate)

**Format:**

- Each deal (9 cards) is played twice, with the bots swapping seats. This swaps both
  hole cards and position, so card luck and position cancel.
- The figures are A's **milli-big-blinds per hand** (mbb/h = chips per deal pair × 250)
  with a 95% normal interval over deal pairs.
- Deal seed 1 everywhere, so every match uses the same deal sequence. Every bot's RNG
  is seeded per hand, so every row reproduces exactly.

Raw lines are in `results/h2h.jsonl` and `results/walt1_vs_equity_behavior.txt`.

**Live Walt** (L1, settings above):

| A | B | deals (hands) | mbb/hand | 95% CI |
|---|---|---|---|---|
| Walt L1 | random | 150 (300) | **+1677** | [+1164, +2190] |
| Walt L1 | station | 150 (300) | **+1000** | [+793, +1207] |
| Walt L1 | flatMC | 150 (300) | **+3647** | [+2862, +4431] |
| Walt L1 | Walt L0 (BR to random, n 1024, full horizon) | 100 (200) | **+3770** | [+2823, +4717] |
| Walt L1 | **equity bot** | 300 (600) | **−593** | [−867, −320] |
| Walt L1 | exploiter | 150 (300) | −217 | [−686, +253] |

**Other Walt configurations:**

| A | B | deals (hands) | mbb/hand | 95% CI |
|---|---|---|---|---|
| Walt L1, street horizon (`n` 128, `horizon` 0) | equity bot | 300 (600) | −663 | [−914, −413] |
| Walt L2, street horizon (`n` 64, `n0` 16) | equity bot | 120 (240) | −492 | [−818, −165] |
| Walt L2, street horizon | Walt L1, street horizon | 80 (160) | +128 | [−268, +524] |
| Walt L0 (n 1024, full horizon) | equity bot | 500 (1000) | −2901 | [−3343, −2459] |
| Walt L0 | station | 500 (1000) | −41 | [−132, +50] |
| Walt L0 | random | 500 (1000) | +3531 | [+3190, +3871] |
| Walt L0 | exploiter | 500 (1000) | −57 | [−480, +365] |

**Baselines among themselves** (for scale):

| A | B | deals (hands) | mbb/hand | 95% CI |
|---|---|---|---|---|
| equity | station | 1000 (2000) | +1004 | [+924, +1085] |
| equity | random | 1000 (2000) | +853 | [+688, +1018] |
| equity | flatMC | 1000 (2000) | +2732 | [+2423, +3040] |
| exploiter | equity | 1000 (2000) | +103 | [−66, +271] |
| flatMC | station | 500 (1000) | −160 | [−238, −82] |
| flatMC | random | 500 (1000) | +3055 | [+2788, +3321] |

**Reading the tables:**

- **Walt beats players that don't fold to it:**
  - It beats loose opponents. Against flatMC, which bluffs off random-play beliefs,
    Walt calls it down.
  - Against the station, it wins exactly what the equity bot wins (+1000 vs +1004).
  - The ladder clearly helps between levels 0 and 1 (+3770 mbb/h).
- **Walt loses to the simplest tight value-better.** Against the equity bot, which
  bets only good hands, Walt loses at every level and horizon tried:
  - L0: −2901
  - L1: −593 to −663
  - L2: −492

  For scale, the gaps between the bots in these tables run from hundreds to thousands
  of mbb/hand. Competitive HULHE bots differ by tens of mbb/hand.
- **L2 vs L1 at equal horizon:** +128 [−268, +524] on 80 deals. This is the card's
  "useful height" question, and it is inconclusive at this size.

## The pure-strategy caveat, measured

**Does Walt bluff?**

The action counts come from the 300-deal live L1 vs equity-bot match, bucketed by
Walt's equity against a random hand (`results/walt1_vs_equity_behavior.txt`). Each cell
counts fold / call / raise when facing a bet, and check / bet when not.

| situation | 0–20% | 20–40% | 40–60% | 60–80% | 80–100% |
|---|---|---|---|---|---|
| river, first to act or checked to | 54 check / **0 bet** | 64 / **0** | 25 / 28 | 0 / 34 | 0 / 52 |
| turn, first to act or checked to | 37 / 0 | 103 / 2 | 44 / 40 | 4 / 57 | 1 / 40 |
| flop, first to act or checked to | 14 / 0 | 135 / 2 | 97 / 43 | 12 / 68 | 3 / 39 |
| river, facing a bet | 17 f / 3 c / 0 r | 4 / 24 / 0 | 0 / 25 / 14 | 0 / 13 / 53 | 0 / 22 / 61 |

- **No bluffs where it matters.** Of 118 river chances to bet with less than 40%
  equity, Walt took **zero**. Across all streets I counted 4 bets and 5 preflop raises
  with weak hands. Walt also folds the river only with its very weakest holdings.
  - **Why:** its model of you is a level-0 mind, a best response to random play. That
    mind bets and calls with almost anything, so in Walt's model a bluff never gets a
    fold, and a bet from you says nothing about your hand.
  - **The result:** Walt plays like a value-betting calling station. A tight player
    profits by betting only for value and folding to Walt's bets, which are always
    value. My hand-tuned exploiter, however, did not beat the plain equity bot
    significantly (−217 vs −593, overlapping intervals).
- **Mixing:** Walt is pure per call, but its sampling noise makes marginal spots come
  out differently from one call to the next. This is incidental noise, not
  equilibrium-frequency mixing.

**Exact exploitability in Leduc hold'em** (`leduc.mjs` + `leduc_exploit.py`,
`results/leduc_exploitability.txt`)

**Setup:**

- Rules are OpenSpiel's `leduc_poker`: 6 cards, ante 1, bets 2 then 4, at most two
  raises a round.
- Walt runs from the same `walt.js` with every consistent deal enumerated (×16, 8 or 4
  replicas so the random bottom rung averages out) and a full horizon.
- I extracted Walt's pure action at all 936 information sets. OpenSpiel's best-response
  code computed exploitability (the best response's average win in chips per hand), and
  its policy evaluation computed the exact expected value against a 2,000-iteration CFR
  policy.

**Results** (three seeds each):

| policy | exploitability (chips/hand) | EV vs CFR (chips/hand) |
|---|---|---|
| CFR, 2000 iterations (≈Nash) | 0.0068 | 0 |
| uniform random | 2.374 | −0.703 |
| always call/check | 1.467 | −0.628 |
| always raise | 2.367 | −0.378 |
| Walt L0 | 3.16–3.20 | −0.51 to −0.67 |
| Walt L1 | 0.75–0.81 | −0.10 to −0.12 |
| Walt L2 | 0.53–0.54 | −0.01 to −0.04 |
| Walt L3 | 0.500 | **+0.0018** |

- **Level 0 is worse than random** against a best response.
- **The ladder converges quickly in head-to-head play.** By level 3 Walt breaks even
  against approximate Nash.
- **Exploitability plateaus at about 0.5 chips/hand**, which is a third of the
  always-call policy's. That is the price of a deterministic, belief-free policy.
- **Hold'em can't reach that height.** In hold'em only level 1 (full) or level 2
  (street horizon only) fit the per-move budget.

## Reproduce

All commands run from `lab/holdem/`, single process, Node 22.

**Engine checks:**

- Evaluator: `node evalcheck.mjs` (exhaustive, 13 s)
- pokerkit oracle: `python3 -m venv V && V/bin/pip install pokerkit open_spiel`, then
  `node oracle_dump.mjs 20000 5 | V/bin/python oracle_check.py`
- OpenSpiel rules oracle: `node oracle_rules_dump.mjs 5000 11 | V/bin/python oracle_rules.py`

**Head-to-head matches:** each `run_set.mjs` call appends one line per match to
`results/h2h.jsonl`. A single match runs with `node h2h.mjs <A> <B> <deals> 1`.

- Baselines and L0: `node run_set.mjs 1 walt0:equity:500 walt0:station:500 walt0:random:500 walt0:exploit:500 equity:flatmc:1000 equity:station:1000 equity:random:1000 exploit:equity:1000 flatmc:station:500 flatmc:random:500` (~1 min)
- Live Walt: `node run_set.mjs 1 walt1:station:150 walt1:exploit:150` (~3 min) and `node run_set.mjs 1 walt1:random:150 walt1:flatmc:150` (~3 min)
- Live Walt vs the equity bot, with the action table: `node behavior.mjs walt1 equity 300 1` (~4.5 min)
- Other configurations: `node run_set.mjs 1 walt1h0:equity:300 walt2h0:equity:120` (~2.5 min) and `node run_set.mjs 1 walt1:walt0:100 walt2h0:walt1h0:80` (~4 min)

**Speed and the page:**

- Timing: `node timing.mjs 200 3`
- Leduc: `V/bin/python leduc_exploit.py` (~5 min; it calls `node leduc.mjs <level> <seed> <reps>`)
- Page: `python3 -m http.server 8765` from `public/`, then
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node page_check.mjs 30 1100`. Add
  `QS='?start=60'` to exercise the match-over path.

Total head-to-head CPU was about 20 minutes, plus about 5 minutes for the Leduc study.

## Page

`/lab/holdem/`: you play against Walt.

- **The table** shows chip stacks, the button and blind badges, the board, the pot, and
  each player's chips in for the hand. A showdown reveals Walt's cards and names both
  hands, with the winner highlighted.
- **Below the table** are a hand log and a "Walt's last decision" panel. The panel
  lists each option's average chips per sampled deal, the number of modeled decisions,
  and the time taken.
- **Walt runs in a module Web Worker.**
- **Playwright and Chromium checks:**
  - At 390 px (phone width), 5–8 hands each run.
  - At 1100 px, 30 hands.
  - The match-over path is covered via `?start=60`, a test hook for starting stacks.
  - Every run had 0 console errors or warnings and no horizontal overflow.

## Caveats

- **Small samples.** Live-Walt matches are 100–300 deals. Duplicate play removes card
  luck but not the noise from decisions. The intervals are normal approximations over
  deal pairs.
- **Weak baselines.** The equity bot is not a strong poker program, so "Walt loses to
  it" says more than "Walt beats random". There is no strong limit hold'em opponent.
  CFR was run only on Leduc.
- **Horizon and rollout.** Beyond the horizon the hand is checked down, so Walt's
  preflop and flop values ignore later betting. Full-horizon level 1 costs about
  1–2 s/move in Node, so I did not use it live or in the head-to-head.
- **Belief updating would be an extension, not a fix within the card.** Filtering
  Walt's own deals by what its model of the opponent would have done is outside the
  card ("what the rule does not buy: correct beliefs"). With level-0 models it would
  not help anyway, because a maniac's bets carry no information. Level 2 and up would
  need it to matter, at a large cost. Not attempted.

## Rerun: Walt with 4× root samples (n = 512)

EXPLORATORY tier. Walt L1 = the live config from `public/lab/holdem/config.js` with only `n` changed from 128 to 512 (harness spec `walt1n512`; level 1, horizon 1, branch 8, n0 32, horizon0 0 unchanged). The shipped page keeps n = 128. Duplicate format, seed 1. mbb/h is A's milli-big-blinds per hand, with a 95% normal interval over deal pairs.

Commands, run from `lab/holdem/`, single process, foreground (`h2h.mjs`'s `runMatch` now takes a `from` deal index; chunks reproduce a single run because deals and per-deal RNGs are keyed by deal index):
```
node chunk_n512.mjs walt1n512 equity 0 100 1   >> results/walt1n512_vs_equity_chunks.jsonl   # ~5.5 min
node chunk_n512.mjs walt1n512 equity 100 200 1 >> results/walt1n512_vs_equity_chunks.jsonl   # ~5.5 min
node chunk_n512.mjs walt1n512 equity 200 300 1 >> results/walt1n512_vs_equity_chunks.jsonl   # ~5.5 min
node merge_n512.mjs results/walt1n512_vs_equity_chunks.jsonl | tee results/walt1n512_vs_equity_behavior.txt
node h2h.mjs walt1n512 exploit 150 1 | tee results/walt1n512_vs_exploit.txt                   # ~2.5 min
```
Single-call equivalent for the equity match: `node h2h.mjs walt1n512 equity 300 1` (about 16 minutes).

| match | n | deals (hands) | mbb/h | 95% CI | pairs W/L/T | ms/move mean | ms/move max |
|---|---|---|---|---|---|---|---|
| Walt L1 vs equity | 128 | 300 (600) | −593 | [−867, −320] | 81/129/90 | 115.5 | 902 |
| Walt L1 vs equity | 512 | 300 (600) | **−634** | [−895, −373] | 69/124/107 | 416.3 | 1791 |
| Walt L1 vs exploit | 128 | 150 (300) | −217 | [−686, +253] | 85/44/21 | 71.3 | 205 |
| Walt L1 vs exploit | 512 | 150 (300) | **−253** | [−740, +234] | 78/48/24 | 286.0 | 789 |

- The n = 128 exploit row is a fresh rerun that reproduced −217 exactly.
- Same-load timing check (first 30 equity deals back to back): n = 128 gave 83 ms mean / 191 max, n = 512 gave 340 ms mean / 767 max, about 4× in the mean. Max ms is noisy under load; compare the means.

**Bluff table at n = 512** (live L1 vs equity, 300 deals; cells are fold/call/raise when facing a bet, check/bet otherwise; columns are equity-vs-random quintiles). The probe's equity-bucket RNG restarts per chunk, which shifts pre-river bucket boundaries slightly; Walt's play and the mbb/h are unaffected.

| situation | 0–20% | 20–40% | 40–60% | 60–80% | 80–100% |
|---|---|---|---|---|---|
| river, first to act or checked to | 53 / **0** | 59 / **0** | 23 / 26 | 0 / 35 | 0 / 53 |
| turn, first to act or checked to | 41 / 0 | 93 / 4 | 47 / 33 | 2 / 57 | 1 / 40 |
| flop, first to act or checked to | 10 / 0 | 143 / 1 | 85 / 49 | 11 / 67 | 1 / 38 |
| river, facing a bet | 13 f / 4 c / 0 r | 3 / 22 / 0 | 0 / 21 / 16 | 0 / 14 / 55 | 0 / 22 / 64 |

**What changed:** nothing but the cost. Against the equity bot Walt still loses by the same margin (−634 vs −593, a 41 mbb/h difference far inside the intervals); against the exploiter it is still not significant. River bluffs with under 40% equity: 0 of 112 chances (0 of 118 at n = 128). This is consistent with the diagnosis above: the losses come from the bet-blind belief model and the level-0 maniac opponent model, not from Monte Carlo sampling noise. Caveats: 300 deals cannot rule out a difference of a few hundred mbb/h, and only `n` was varied.
