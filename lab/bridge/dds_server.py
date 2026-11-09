"""Double-dummy oracle for the bridge h2h (PIMC baseline + deal screening).

EXPLORATORY tier. Runs inside a scratch venv that has `endplay` (bundles the
DDS solver) installed; the Node harness spawns it and talks JSON lines:

  {"op":"solve","trump":t,"leader":s,"trick":[c...],"pbns":[...]}
      -> {"res":[[[card,tricks],...] per pbn]}
     tricks = what the side to move wins from the remaining tricks (incl. the
     current one), per legal card. pbn hands still hold the current-trick cards.
  {"op":"dd","pbns":[...],"trump":t,"decl":s}
      -> {"res":[declarer tricks with declarer's LHO on lead, per pbn]}

Card ids follow public/lab/bridge/engine.js: suit*13+rank, suit 0..3 = C,D,H,S,
rank 0..12 = 2..A; strain 4 = NT; seats 0..3 = N,E,S,W (same as endplay Player).
"""
import json
import sys

from endplay.dds import solve_board
from endplay.types import Card, Deal, Denom, Player, Rank


def denom(t):
    return Denom.nt if t == 4 else Denom(3 - t)


def to_card(c):
    return Card(suit=Denom(3 - c // 13), rank=Rank(1 << (c % 13 + 2)))


def from_card(card):
    return (3 - int(card.suit)) * 13 + int(card.rank).bit_length() - 3


def solve(req):
    out = []
    for pbn in req["pbns"]:
        d = Deal.from_pbn(pbn)
        d.trump = denom(req["trump"])
        d.first = Player(req["leader"])
        for c in req["trick"]:
            d.play(to_card(c))
        out.append([[from_card(card), tricks] for card, tricks in solve_board(d)])
    return out


def dd(req):
    out = []
    lho = (req["decl"] + 1) % 4
    for pbn in req["pbns"]:
        d = Deal.from_pbn(pbn)
        d.trump = denom(req["trump"])
        d.first = Player(lho)
        best = max(t for _, t in solve_board(d))
        out.append(13 - best)
    return out


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            res = solve(req) if req["op"] == "solve" else dd(req)
            sys.stdout.write(json.dumps({"res": res}) + "\n")
        except Exception as e:  # report, keep serving
            sys.stdout.write(json.dumps({"error": repr(e)}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
