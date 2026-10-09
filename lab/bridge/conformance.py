"""Replays conformance.mjs games in endplay; see conformance.mjs. EXPLORATORY tier."""
import json
import sys

from endplay.types import Card, Deal, Denom, Player, Rank

games = json.load(sys.stdin)
bad = 0
for g in games:
    d = Deal.from_pbn(g["pbn"])
    d.trump = Denom.nt if g["strain"] == 4 else Denom(3 - g["strain"])
    d.first = Player(g["first"])
    leaders = []
    for i, c in enumerate(g["plays"]):
        card = Card(suit=Denom(3 - c // 13), rank=Rank(1 << (c % 13 + 2)))
        if card not in list(d.legal_moves()):
            raise SystemExit(f"illegal card {card} in game {games.index(g)} at ply {i}")
        d.play(card)
        if (i + 1) % 4 == 0:
            leaders.append(int(d.first))
    bad += leaders != g["leaders"]
print(f"games {len(games)}, trick-winner mismatches {bad}")
