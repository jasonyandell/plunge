# Walt: algorithm card

Copied from [texas-42 issue #99](https://github.com/jasonyandell/texas-42/issues/99)
for the `/lab/` game experiments. EXPLORATORY tier. Reference implementation:
`walt/probes/simple_walt/walt42.py` on texas-42's `ccr-7425ff15-uya1yg` (PR #97;
162 lines of stdlib Python, rules included; the algorithm is two functions).

## The idea

A ladder of best responses that bottoms out at random. Given my seat's information,
which play makes the bid most often? Answer it by sampling the deals I can't rule out,
choosing **one** move across all of them, and modeling every other seat as a player
who answers the same question from its own chair, one rung lower, until the bottom
rung plays random legal tiles.

- **Level 0:** best response to random play.
- **Level 1** (the live player): best response to level-0 seats.
- **Level k:** best response to level k−1.

In 42 the useful height measured at one rung: L2 vs L1 tied 14 / 14 / 72 on 100
mirrored deals at ~5× the cost.

## The information rule

**A decision may read only its decider's own holding, the public record, and noise
independent of the deal.** This single rule is the whole anti-strategy-fusion content
of walt. Fusion is exactly a violation of it: a searcher's choice differing across
worlds at one information set because it looked at the world. In the code below:

- my `max` is taken once over the whole group of deals, so I read only (my hand, public);
- each modeled seat's `decide` is called with (its hand, public) and nothing else;
- a modeled seat's belief is **sampled from its own chair**. Reusing my deals as its
  belief would leak my hand through the sample. This is why the nested shuffle can't
  be skipped.

What the rule does not buy: correct beliefs. Modeled seats condition on what is lawful
(voids, hand sizes), never on inferences about my policy.

## The interface

```
to_move(public)                         whose turn it is
outcome(public)                         True / False / None
private(deal, seat, public)             what `seat` holds now, derived from the deal and what's been played
legal(private, public)                  its options
play(public, action)                    the public state after an action
sample(seat, private, public, n, rng)   n deals consistent with what `seat` can see
maximizes(seat)                         which side it's on
```

## The algorithm

```python
def decide(game, seat, private, public, level, rng, n):
    options = game.legal(private, public)
    if len(options) == 1:
        return options[0]
    deals = game.sample(seat, private, public, n, rng)        # from seat's chair only
    made = {a: value(game, seat, game.play(public, a), deals, level, rng) for a in options}
    return (max if game.maximizes(seat) else min)(options, key=made.get)

def value(game, me, public, deals, level, rng):
    done = game.outcome(public)
    if done is not None:
        return len(deals) if done else 0
    seat = game.to_move(public)
    if seat == me:                       # one action for every deal I can't tell apart
        pick = max if game.maximizes(me) else min
        return pick(value(game, me, game.play(public, a), deals, level, rng)
                    for a in game.legal(game.private(deals[0], me, public), public))
    groups = {}                          # what does `seat` do in each deal?
    for deal in deals:
        mine = game.private(deal, seat, public)
        a = (rng.choice(game.legal(mine, public)) if level == 0
             else decide(game, seat, mine, public, level - 1, rng, N_INNER))
        groups.setdefault(a, []).append(deal)
    return sum(value(game, me, game.play(public, a), g, level, rng) for a, g in groups.items())
```

Exact integer counts, no floats. The reference file adds one early exit at my own turn
(stop once a move makes in every deal), which is most of its speed.

Two things distinguish it from flat Monte Carlo ("sample deals, random playouts, pick
the best make rate"): my own later moves are chosen, one per situation, not random; and
the other seats best-respond from their own chairs rather than playing random. Two
things distinguish it from PIMC / αμ: no per-deal solving (so no strategy fusion), and
non-clairvoyant opponents.

## Where it applies

Any game where the only hidden thing is the deal and every action is seen by everyone:
42, bridge play, spades, hearts, euchre, Skat's play phase. Bids are public, so bidding
is a `play` that accepts a bid. Hidden or simultaneous actions do not fit. If a game's
score reads hidden cards at the end, `outcome` takes the deal and the terminal line
becomes `sum(payoff(d, public) for d in deals)`.

## Cost

The ladder is the cost: each modeled decision spawns a level-0 solve over its own
worlds. Lawful levers: `n0` (worlds per modeled mind; `n0 = 1` is the cheapest lawful
opponent), horizon (minds for the next k decisions, dice after), and common random
numbers across candidate moves.

## Related work

Level-k / cognitive hierarchy for the ladder. Strategy fusion and non-locality: Frank &
Basin; the one-move-per-information-set fix: αμ (Cazenave & Ventos) and
multiple-observer ISMCTS (Cowling, Powley, Whitehouse 2012); recursive Monte Carlo
search for bridge (Bouzy, Rimbaud, Ventos).
