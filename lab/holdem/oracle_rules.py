"""Replay this engine's hands in OpenSpiel's universal_poker (ACPC limit
hold'em gamedef) and compare actor, legal actions and final payoffs.
OpenSpiel player 0 = big blind = engine seat 1; player 1 = engine seat 0.
Run: node oracle_rules_dump.mjs 5000 11 | <venv>/bin/python oracle_rules.py"""
import json
import sys
import pyspiel

game = pyspiel.load_game('universal_poker', {
    'betting': 'limit', 'numPlayers': 2, 'numRounds': 4, 'blind': '2 1',
    'raiseSize': '2 2 4 4', 'firstPlayer': '2 1 1 1', 'maxRaises': '3 4 4 4',
    'numSuits': 4, 'numRanks': 13, 'numHoleCards': 2, 'numBoardCards': '0 3 1 1',
    'stack': '1000 1000'})
BOARD_AT = {1: [4, 5, 6], 2: [7], 3: [8]}
bad = n = 0
for line in sys.stdin:
    h = json.loads(line)
    c = h['cards']
    s = game.new_initial_state()
    for x in [c[2], c[3], c[0], c[1]]:  # OS p0 (= seat 1) is dealt first
        s.apply_action(x)
    street = 0
    ok = True
    for st in h['steps']:
        while st['street'] > street:
            street += 1
            for i in BOARD_AT[street]:
                s.apply_action(c[i])
        if s.current_player() != 1 - st['seat'] or sorted(s.legal_actions()) != sorted(st['legal']):
            ok = False
            print('MISMATCH at', st, s.current_player(), s.legal_actions())
            break
        s.apply_action(st['a'])
    if ok:
        while s.is_chance_node():  # hand ended on a call before the board was out
            street += 1
            for i in BOARD_AT[street]:
                s.apply_action(c[i])
        if not s.is_terminal() or round(s.returns()[1]) != h['pay0']:
            ok = False
            print('PAYOFF MISMATCH', h['pay0'], s.returns(), s.is_terminal())
    n += 1
    bad += 0 if ok else 1
    if bad >= 5:
        break
print(f'{n} hands replayed, {bad} mismatches')
sys.exit(1 if bad else 0)
