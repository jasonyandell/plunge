# Texas 42 — Complete Rules Reference

This document is the authoritative rules reference for this project. It consolidates
[pagat.com (John McLeod)](https://www.pagat.com/domino/trick/42.html),
[pagat.com (Joe Celko)](https://www.pagat.com/domino/trick/texas42.html),
[Wikipedia: 42 (dominoes)](https://en.wikipedia.org/wiki/42_(dominoes)),
the **N42PA Tournament Rules** (National 42 Players Association, approved 2019-09-27),
and [texas42.net](http://texas42.net) (tournament sample rules, fair-play rules, house rules).

Where sources disagree, the disagreement is flagged with **⚠ VARIANT** and a recommended
default is stated. Section 9 collects every disagreement as a configuration matrix for
the game implementation.

---

## 1. Overview and Equipment

- **Players:** 4, in two fixed partnerships. Partners sit opposite each other (N/S vs E/W).
- **Set:** standard double-six domino set — **28 dominoes**, one for each unordered pair of
  pip values 0 (blank) through 6.
- **Object of a hand:** there are exactly **42 points** at stake per hand (hence the name):
  - **1 point per trick** × 7 tricks = 7 points
  - **Count dominoes** = 35 points:
    - **10-count** (pips total 10): `5-5`, `6-4` — 10 points each
    - **5-count** (pips total 5): `5-0`, `4-1`, `3-2` — 5 points each
- **Object of the game:** first partnership to **7 marks** wins (standard). A point-scoring
  alternative plays to 250 points (§8.6).
- A team's hand score = count points captured in its tricks **plus** number of tricks taken.

History: invented 1887 in Garner, Texas, by William Thomas and Walter Earl as a domino
stand-in for card games. Official State Domino Game of Texas (2011). State championship
held annually in Hallettsville, TX.

## 2. The Shake (Shuffle) and Draw

1. **First shaker:** each player draws one domino; highest pip total shakes first. Ties are
   redrawn by the tying players. (N42PA: in later games of a multi-game match, the team
   that **lost** the previous game draws for first shake.)
2. The shaker turns all 28 dominoes face down and mixes ("shakes"/"washes") them.
3. **Draw:** each player draws 7 dominoes.
   - **⚠ VARIANT — draw order.** Casual (pagat): shaker's opponents draw first, then
     shaker's partner, then shaker. Tournament (N42PA Rule 2): the **shaker must draw
     last**; everyone else may draw in any order. *Default: shaker draws last; others in
     any order.*
4. Players stand their dominoes on edge facing themselves. **Tournament (N42PA Rules
   8/13):** hands must be arranged in a 4-3 or 3-4 row format before bidding begins, and
   may not be rearranged once bidding starts. Blind bidding (hand face down) is not
   allowed.
5. The shake rotates clockwise (to the left) each hand.

## 3. Bidding

- The player to the shaker's **left** bids first; bidding proceeds **clockwise**, ending
  with the shaker. Each player gets **exactly one** turn: bid or pass.
- Each bid must be strictly higher than the current high bid.
- **Bid ladder:** `30, 31, 32, …, 41, 42`. A bid of 42 = **1 mark**. Above that, bids are
  in marks: **2 marks** (84), 3 marks, 4 marks, …
- **Opening cap:** the highest allowed opening bid is **2 marks (84)**.
- **No jump bids above 2 marks:** a bid above 2 marks may only raise the previous bid by
  **one mark** (3 marks may only be bid over 2 marks, etc.).
- **Sole exception — Plunge** (§8.2, casual play only): a player holding 4+ doubles may
  open at 4 marks, jump to 4 marks over any lower bid, or bid 5 marks over an existing
  4-mark bid.
- **All four players pass:**
  - **Standard / tournament (N42PA Rule 4):** the hand is thrown in; the shake rotates to
    the next player; no marks are scored. **Tournament play is never forced-bid.**
  - **⚠ VARIANT — forced bid:** many casual tables force the shaker to bid 30. Sub-options:
    the forced shaker may instead bid 1–2 marks of Nel-O ("forced low", §8.1); a few house
    rules award 2 marks if a forced 30-bid takes all 7 tricks. *Default: throw in and
    reshake.*
- **What a bid means:** the bidding team contracts to take **at least that many points**
  (tricks + count). The opponents **set** the contract by taking **more than 42 − bid**
  points. A bid of 42 or more requires taking **all 42 points**, which necessarily means
  winning **all 7 tricks and all count** (losing any trick loses at least 1 point).
- **Tournament etiquette (N42PA):** bids must be announced bare ("31", "pass") with no
  added commentary. A bid made out of turn stands as a constraint: when bidding reaches
  that player properly, they may neither raise nor lower it.

## 4. Declaring Trump

The winning bidder (the **declarer**) names trump **before leading the first domino**.
Options:

1. **A pip suit, 0 (blanks) through 6.**
2. **Doubles as trump:** the 7 doubles form their own trump suit, ranking `6-6` (high)
   down to `0-0` (low).
3. **No trump ("follow me"):** no trump suit exists.
   - **⚠ VARIANT:** doubles **high** in each suit (standard; only form allowed by N42PA)
     or doubles **low** in each suit (declarer announces which). *Default: doubles high.*
   - "Follow me with doubles as their own suit" is a house variant explicitly banned by
     N42PA Rule 1.

**Tournament rule (sample rule 12):** if the declarer leads without declaring, the higher
end of the first domino played becomes trump by default. (For implementation: simply
require an explicit declaration before the lead.)

### 4.1 Suit membership and ranking — precise definitions

With trump suit `t` (a pip value):

- **Trump:** every domino containing `t` is a trump and belongs **only** to the trump
  suit (it no longer belongs to its other suit). There are exactly 7 trumps. Ranking:
  `t-t` highest, then descending by the non-trump end.
  Example, threes trump: `3-3 > 6-3 > 5-3 > 4-3 > 3-2 > 3-1 > 3-0`.
- **Non-trump dominoes:** a non-trump domino `a-b` (a ≥ b) belongs to **both** suit `a`
  and suit `b` for purposes of *following* suit, but when **led** it counts as a member of
  its **higher** suit `a`. Within a non-trump suit `s`, ranking is: `s-s` (the double)
  highest, then descending by the other end.
  Example, sixes (not trump): `6-6 > 6-5 > 6-4 > 6-3 > 6-2 > 6-1 > 6-0` —
  minus any of those that contain the trump number, which are trumps instead.
- **Doubles trump:** the 7 doubles are the trump suit (`6-6` high … `0-0` low). Every
  non-double belongs to both of its pip suits; when led, its higher end governs. A led
  double calls for doubles.
- **No trump:** the led domino's higher end sets the suit; the highest domino of the led
  suit wins every trick (nothing can trump).

## 5. Play of the Hand

1. The **declarer leads** to the first trick.
2. The led domino defines the led suit: **trump** if it contains the trump number (or is
   a double under doubles-trump), otherwise its **higher end**.
3. **Following suit:** each other player, in clockwise order, must play a domino of the
   led suit if they hold one. (A domino containing the led number that is a trump does
   **not** follow a non-trump lead — it is a trump, not a member of that suit.) A player
   void in the led suit may play **anything**, including a trump.
4. **Trick winner:** the highest trump played; if no trump was played, the highest domino
   of the **led suit**. Off-suit discards ("sluffs") can never win a trick.
5. The trick winner leads the next trick. 7 tricks complete the hand.
6. The hand may end early once the outcome is decided (bid made or set).

### 5.1 Tournament play discipline (N42PA)

- "A domino laid is a domino played" — and you must play the first domino you **touch**,
  even if it costs a renege.
- An accidentally **exposed** domino stays face up in front of its owner and must be
  played at the first legal (non-renege) opportunity, including being led when its owner
  is on lead.
- On mark bids (42+), tricks are **stacked** face down (no looking back at played
  dominoes); once a trick is gathered, you may not ask who played what.
- You may ask at any time who shook, who bid, and what the bid was — but asking "what is
  trump?" after the first domino is played forfeits a mark to the opponents.
- **Laydown claim (N42PA Rule 16):** the declarer may claim the remaining tricks. If the
  opponents can demonstrate *any* legal line of play that would still set the bid, the
  declaring team forfeits the hand.
- At the end of a hand decided early, all dominoes are turned face up so reneges can be
  verified.

### 5.2 Reneges and misplays

A **renege** is a failure to follow suit when able. Leading or playing out of turn and
"talking across the table" are penalized the same way.

- **Tournament (N42PA Rule 5):** the hand ends immediately; the offending team loses the
  value of the hand — the opponents are awarded 1 mark, or the full number of marks bid
  if the bid was above 42.
- **Casual:** no codified penalty; tables typically replay or award the hand by agreement.
  *Default for implementation: prevent illegal plays at the engine level (reneges become
  impossible); apply the N42PA penalty only if simulating physical-play rules.*

## 6. Scoring (Marks — standard)

- Each hand is worth **marks** to exactly one team:
  - Bids **30–41** and **42**: worth **1 mark**. Declaring team scores it by making the
    bid; otherwise the opponents score it (a set always awards defenders exactly the
    contract's value).
  - Bids of **2+ marks**: the number of marks bid, to whichever side prevails.
- A hand can be claimed/conceded as soon as the result is mathematically decided (e.g.,
  the defenders capture enough count to set, or any defender trick against a mark bid).
- **Game:** first team to **7 marks**. Marks are traditionally tallied by drawing the
  letters of the word **ALL** stroke by stroke.

## 7. Communication and Fair Play (tournament)

- **No table talk:** no physical cues, gestures, deliberate timing tells, tapping or
  pointing at dominoes, or verbal commentary beyond the bare bid/play.
- **No conventions (N42PA Rule 17, 2019):** any privately pre-arranged signal — bidding
  conventions ("32 means I have the 5-5"), double-count indications, domino-placement
  codes — is cheating. An agreement that a bid means non-specific "help" is permissible
  but frowned upon.
- Spectators may not comment on a live game, even to point out a renege.
- 20 seconds per bid (sample tournament rule); no deliberate slow play by a leading team.

## 8. Special Contracts and Variants

> **Tournament note:** N42PA / Hallettsville "straight 42" allows **only** pip-suit
> trump, doubles trump, and follow-me (doubles high). **Nel-O, Sevens, Plunge, Splash,
> doubles-as-own-suit follow-me, and forced bids are all banned** in sanctioned play.
> Everything in this section is casual/house play.

### 8.1 Nel-O (Nello / Low / Low Boy / No Trick)

- **Contract:** the declarer must **lose every trick**. The hand ends the instant the
  declarer wins a trick. Count dominoes are irrelevant.
- **Bid value:** 1 mark minimum (pagat, Wikipedia, texas42.net); raised in marks like any
  mark bid. **⚠ VARIANT:** some tables require 2 marks minimum.
- **Availability — ⚠ VARIANT:** (a) any player whose bid reaches 1+ marks may declare
  Nel-O (open version); (b) **forced-bid only** — available only to a shaker forced to
  bid after three passes (very common; the only version some tables play). *Default:
  open version, with forced-only as a config option.*
- **Partner sits out:** the declarer's partner turns their dominoes **face down** and
  takes no part in the play. Play is declarer vs. both opponents (3-handed).
- **Lead:** declarer leads trick 1; trick winner leads on.
- **No trumps exist.** Doubles treatment — **⚠ VARIANT**, declared before play:
  1. **Doubles are their own suit** (most common; *default*): rank `6-6` high … `0-0`
     low; a led double calls for doubles; non-double leads follow the higher end.
  2. Doubles **high** in their natural suits (as in regular play).
  3. Doubles **low** in their natural suits (the `6-0` beats the `6-6`).
  4. Doubles as their own suit **inverted** (`0-0` high … `6-6` low) — rare.
- **Scoring:** marks bid to the declaring team if the declarer takes no trick; to the
  opponents the moment the declarer takes one.

### 8.2 Plunge

- **Hand requirement:** declarer must hold **at least 4 doubles** (opponents may demand
  to see them before the first trick).
- **Bid:** minimum **4 marks**. This is the **only** legal jump bid / opening above 2
  marks: a Plunge may open at 4, jump to 4 over any lower bid, or bid **5 over an
  existing 4-mark bid** (and by extension 6 over 5).
  **⚠ VARIANT:** some tables play Plunge at 3 marks, or as a plain 2-mark (84) bid with a
  "plunge" declaration. *Default: 4 marks, jump rules as above.*
- **Trump:** the declarer's **partner** names trump based on their own hand, with no
  hints.
- **First lead — ⚠ VARIANT:** (a) the **declarer** leads after partner names trump
  (pagat); (b) the **partner** names trump *and* leads (texas42.net and others).
  *Default: partner names trump and leads — the more common table practice.*
- **Win condition:** the declaring team must take **all 7 tricks**. One defender trick
  sets the contract. Marks won/lost = marks bid.

### 8.3 Splash

Identical mechanism to Plunge with a lower threshold:

- Requires **at least 3 doubles**.
- **Bid value — ⚠ VARIANT:** 2 marks (pagat) or 3 marks (Wikipedia); commonly stated as
  "**2 or 3 marks** at bidder's choice." *Default: 2 or 3 marks.* No jump privilege is
  documented for Splash (it fits inside the normal ladder).
- Partner names trump (and leads, matching the Plunge default); team must take all 7
  tricks.
- *Option (pagat):* some tables let the Plunge/Splash partner choose No Trump — or even
  Sevens or Nel-O — instead of naming a trump suit. Off by default.

### 8.4 Sevens

- **Bid:** minimum 1 mark (42). **⚠ VARIANT:** some tables play it at 2 marks, or allow
  it only on forced bids. Declared after winning the bid; declarer leads.
- **Mechanics:** no suits, no trumps, no following. On every trick, **each player must
  play the domino in their hand whose pip total is closest to 7** (free choice only
  among equally-close tiles). The trick is won by the domino closest to 7; on ties,
  the **earliest played** of the tied dominoes wins.
- **Win condition:** declarer must win all 7 tricks.
- The play is completely forced — there is no strategy after the declaration. (This is
  why it is widely banned; pagat notes it is also disallowed in the point-scoring game.)

### 8.5 Forced-bid package (house play)

When all four players pass and the table plays forced bids: the shaker must bid **30**,
and (optionally) may instead declare **1 or 2 marks of Nel-O**. Optional house bonus:
a forced 30 bid that takes all 7 tricks scores 2 marks.

### 8.6 Point scoring ("game to 250")

The older scoring system, no marks:

- Bid ladder: 30–41, 42, then **84**, then **168** (doubling, instead of linear marks).
- Bids **under 42**: if made, **both** teams score the points they actually took; if set,
  the declaring team scores **0** and the defenders score their points taken **plus the
  amount of the bid**.
- Bids of **42 / 84 / 168**: all-or-nothing — the winning side scores the bid amount
  only.
- All-pass: the shaker **must** bid (no throw-in). The shaker forced to bid may declare
  **Low-No** (the Nel-O equivalent, worth 42 points) — Plunge and Sevens are **not**
  played in this variant.
- **Game:** first team to **250 points**.

### 8.7 Related games (out of scope, documented for completeness)

- **Moon:** 3-player relative using a reduced set; bid 4–7 tricks; "shooting the moon" =
  all tricks; game to 21.
- **80 / 88:** six- and eight-player adaptations using two double-six sets.
- **The Big Game (Celko):** double-8 set, 45 tiles, 66 points/hand, game to 400.
- "Mexican Train" is an unrelated layout game. "Sluff" is the discard term, not a
  variant. "Low Boy" is a synonym for Nel-O.

## 9. Implementation Configuration Matrix

Every documented rules fork, with the recommended default for this project:

| # | Option | Choices | Default |
|---|--------|---------|---------|
| 1 | Game mode | Marks to 7 / Points to 250 | **Marks to 7** |
| 2 | All-pass handling | Reshake (rotate shaker) / Forced bid 30 / Forced bid with Nel-O option | **Reshake** |
| 3 | Nel-O | Off (straight 42) / On, open / On, forced-bid only | **On, open** (off in "tournament" preset) |
| 4 | Nel-O minimum bid | 1 mark / 2 marks | **1 mark** |
| 5 | Nel-O doubles | Own suit / High in suit / Low in suit / Own suit inverted | **Own suit** |
| 6 | Plunge | Off / On | **On** (off in tournament preset) |
| 7 | Plunge value | 4 marks + jump privilege / 3 marks / 2 marks declared | **4 marks + jump** |
| 8 | Plunge first lead | Partner names trump and leads / Declarer leads | **Partner leads** |
| 9 | Splash | Off / On | **On** (off in tournament preset) |
| 10 | Splash value | 2 marks / 3 marks / bidder's choice of 2–3 | **2 or 3, bidder's choice** |
| 11 | Sevens | Off / On / Forced-bid only | **Off** (degenerate; opt-in) |
| 12 | Follow-me doubles | High (standard) / Low / Own suit | **High** (own-suit banned in tournament preset) |
| 13 | Forced 30 sweep bonus | Off / 2 marks for all 7 tricks | **Off** |
| 14 | Renege handling | Engine-prevented / N42PA penalty (hand forfeit) | **Engine-prevented** |

**Presets:**
- **Tournament (N42PA straight 42):** options 3, 6, 9, 11 off; 2 = reshake; 12 = high;
  marks to 7.
- **Casual (common Texas house game):** Nel-O on (own-suit doubles), Plunge 4 marks,
  Splash 2–3, Sevens off, reshake on all-pass.

## 10. Invariants for the Engine (test checklist)

These must hold in every hand and make good property-based tests:

1. The 28-domino set is fixed; 4 hands × 7 dominoes partitions it exactly.
2. Total points per hand = 42 (7 trick points + 35 count points: two 10s, three 5s).
3. With pip trump `t`, exactly 7 dominoes are trump; trump membership is exclusive
   (a trump never follows a non-trump lead of its other suit).
4. A led non-trump, non-double domino always belongs to its higher end's suit.
5. A bid of `n < 42` is made iff declaring team's points ≥ n, and set iff defenders'
   points ≥ 43 − n; the two conditions are mutually exclusive and exhaustive.
6. Any bid ≥ 1 mark is made iff the declaring team wins all 7 tricks (and therefore all
   42 points); it is set the moment defenders win any trick.
7. Nel-O is set the moment the declarer wins a trick; made iff declarer wins 0 tricks.
   The sat-out partner's dominoes never enter play.
8. In Sevens, every play is forced up to ties; trick winner = closest to 7, earliest
   played breaks ties.
9. Bid ladder legality: 30 ≤ bid ≤ 42 or whole marks; strictly increasing; one bid per
   player; opening ≤ 2 marks and +1-mark raises above 2 marks, except Plunge.
10. Plunge requires ≥ 4 doubles in the declarer's hand; Splash ≥ 3. (Validate at bid
    time — the engine should refuse the bid otherwise.)
11. A hand always awards exactly one team exactly the contract's mark value (mark mode).
