"""Cross-check the engine's showdown signs against pokerkit (independent
evaluator). Run: node oracle_dump.mjs 20000 5 | <venv>/bin/python oracle_check.py"""
import sys
from pokerkit import StandardHighHand

bad = n = 0
for line in sys.stdin:
    *cards, sign = line.split()
    h0, h1, board = ''.join(cards[0:2]), ''.join(cards[2:4]), ''.join(cards[4:9])
    a = StandardHighHand.from_game(h0, board)
    b = StandardHighHand.from_game(h1, board)
    want = 1 if a > b else -1 if a < b else 0
    n += 1
    if want != int(sign):
        bad += 1
        if bad < 5:
            print('MISMATCH', line.strip(), want)
print(f'{n} deals, {bad} mismatches')
sys.exit(1 if bad else 0)
