// Exhaustive evaluator check: 7-card category frequencies over all C(52,7)
// hands and the 7,462 distinct 5-card hand classes. Known counts are textbook.
import { evalCards } from '../../public/lab/holdem/cards.js';
const want7 = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584];
const want5 = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];
const h = new Int8Array(7);
const got7 = new Array(9).fill(0), got5 = new Array(9).fill(0);
const classes = new Set();
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++)
  for (let d = c + 1; d < 52; d++) for (let e = d + 1; e < 52; e++) {
    h[0] = a; h[1] = b; h[2] = c; h[3] = d; h[4] = e;
    const s5 = evalCards(h, 0, 5); got5[s5 >> 20]++; classes.add(s5);
    for (let f = e + 1; f < 52; f++) { h[5] = f;
      for (let g = f + 1; g < 52; g++) { h[6] = g; got7[evalCards(h, 0, 7) >> 20]++; } }
  }
const ok = JSON.stringify(got7) === JSON.stringify(want7) && JSON.stringify(got5) === JSON.stringify(want5) && classes.size === 7462;
console.log('7-card', got7.join(' '));
console.log('5-card', got5.join(' '), 'classes', classes.size);
console.log(ok ? 'EVALUATOR OK' : 'EVALUATOR MISMATCH');
process.exit(ok ? 0 : 1);
