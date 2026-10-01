#!/bin/sh
# Reproduce the h2h tables in REPORT.md (single process, one match at a time).
# Each line is one chunk (< 10 min); chunks append to results/*.jsonl.
# Seed 2026 for every match: all matches play the same deal set (deal i, dealer i mod 4).
set -e
cd "$(dirname "$0")/../.."
R=lab/euchre/results
W1="walt:level=1,n=24,n0=8"
W2="walt:level=2,bidLevel=1,bidN=24,n=12,n1=6,n0=8"
rm -f lab/euchre/results/*.jsonl lab/euchre/results/*.timing.txt
node lab/euchre/h2h.mjs --a rule        --b random      --deals 200 --seed 2026 --out $R/rule_vs_random.jsonl
node lab/euchre/h2h.mjs --a pimc:n=40   --b rule        --deals 200 --seed 2026 --out $R/pimc_vs_rule.jsonl
node lab/euchre/h2h.mjs --a pimc:n=40,bid=1 --b rule    --deals 200 --seed 2026 --out $R/pimcplay_vs_rule.jsonl
node lab/euchre/h2h.mjs --a $W1 --b random    --deals 50  --seed 2026 --out $R/walt1_vs_random.jsonl
node lab/euchre/h2h.mjs --a $W1 --b rule      --deals 100 --seed 2026 --out $R/walt1_vs_rule.jsonl
node lab/euchre/h2h.mjs --a $W1 --b rule      --deals 100 --start 100 --seed 2026 --out $R/walt1_vs_rule.jsonl
node lab/euchre/h2h.mjs --a $W1 --b pimc:n=40 --deals 75  --seed 2026 --out $R/walt1_vs_pimc.jsonl
node lab/euchre/h2h.mjs --a $W1 --b pimc:n=40 --deals 75  --start 75 --seed 2026 --out $R/walt1_vs_pimc.jsonl
node lab/euchre/h2h.mjs --a $W2 --b $W1       --deals 10  --seed 2026 --out $R/walt2play_vs_walt1.jsonl
node lab/euchre/h2h.mjs --a $W2 --b $W1       --deals 25  --start 10 --seed 2026 --out $R/walt2play_vs_walt1.jsonl
node lab/euchre/h2h.mjs --a $W2 --b $W1       --deals 25  --start 35 --seed 2026 --out $R/walt2play_vs_walt1.jsonl
node lab/euchre/summarize.mjs $R/*.jsonl
