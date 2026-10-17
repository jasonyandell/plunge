// Baseline players and the Walt wrapper. Each bot: act(view, rng) -> action,
// view = { seat, hole:[a,b], board:[visible], pub }. A bot reads only its own
// hole cards, the visible board and the public betting record.
import { evalCards } from '../../public/lab/holdem/cards.js';
import * as G from '../../public/lab/holdem/game.js';
import { decide } from '../../public/lab/holdem/walt.js';

export const randomBot = { name: 'random', act: (v, rng) => { const o = G.legal(v.pub); return o[rng.int(o.length)]; } };
export const stationBot = { name: 'station', act: () => G.CALL };
export const maniacBot = { name: 'maniac', act: (v) => (G.legal(v.pub).includes(G.RAISE) ? G.RAISE : G.CALL) };

// Equity vs one uniformly random hand, as an integer count out of 2*k
// (win = 2, tie = 1). Exact enumeration on the river, Monte Carlo before it.
const h7 = new Int8Array(7), o7 = new Int8Array(7);
export function equity2(hole, board, k, rng) {
  const used = new Uint8Array(52);
  for (const x of hole) used[x] = 1;
  for (const x of board) used[x] = 1;
  const rest = [];
  for (let c = 0; c < 52; c++) if (!used[c]) rest.push(c);
  h7[0] = hole[0]; h7[1] = hole[1]; o7.fill(0);
  for (let i = 0; i < board.length; i++) { h7[2 + i] = board[i]; o7[2 + i] = board[i]; }
  let got = 0, tot = 0;
  if (board.length === 5) {
    const me = evalCards(h7, 0, 7);
    for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
      o7[0] = rest[i]; o7[1] = rest[j];
      const op = evalCards(o7, 0, 7);
      got += me > op ? 2 : me === op ? 1 : 0; tot += 2;
    }
    return [got, tot];
  }
  const need = 5 - board.length;
  for (let t = 0; t < k; t++) {
    // partial shuffle of rest for 2 opp cards + `need` board cards
    for (let i = 0; i < 2 + need; i++) { const j = i + rng.int(rest.length - i); const x = rest[i]; rest[i] = rest[j]; rest[j] = x; }
    o7[0] = rest[0]; o7[1] = rest[1];
    for (let i = 0; i < need; i++) { h7[2 + board.length + i] = rest[2 + i]; o7[2 + board.length + i] = rest[2 + i]; }
    const me = evalCards(h7, 0, 7), op = evalCards(o7, 0, 7);
    got += me > op ? 2 : me === op ? 1 : 0; tot += 2;
  }
  return [got, tot];
}

// Rule-based equity-threshold bot (percent thresholds, integer comparisons).
export function equityBot({ bet = 58, raise = 66, call = 40, k = 300 } = {}) {
  return {
    name: `equity(${bet}/${raise}/${call})`,
    act(v, rng) {
      const opts = G.legal(v.pub);
      const [g, t] = equity2(v.hole, v.board, k, rng);
      const ge = (p) => g * 100 >= p * t;
      if (opts.includes(G.FOLD)) { // facing a bet
        if (opts.includes(G.RAISE) && ge(raise)) return G.RAISE;
        return ge(call) ? G.CALL : G.FOLD;
      }
      return opts.includes(G.RAISE) && ge(bet) ? G.RAISE : G.CALL;
    },
  };
}

// Flat Monte Carlo: per legal action, k sampled worlds (opponent hole cards +
// runout, uniform from the bot's chair), both seats random afterwards; pick
// the action with the highest chip total. Integer sums.
export function flatMcBot({ k = 200 } = {}) {
  return {
    name: `flatMC(${k})`,
    act(v, rng) {
      const opts = G.legal(v.pub);
      const deals = G.sample(v.seat, { seat: v.seat, hole: v.hole, board: v.board }, v.pub, k, 0, 1, rng);
      let best = -Infinity, act = opts[0];
      for (const a of opts) {
        let s = 0;
        for (const d of deals) {
          let p = G.play(v.pub, a);
          while (!p.done) { const o = G.legal(p); p = G.play(p, o[rng.int(o.length)]); }
          s += G.payoff(p, v.seat, d.sd);
        }
        if (s > best) { best = s; act = a; }
      }
      return act;
    },
  };
}

export function waltBot(level, cfg, name) {
  return {
    name: name || `walt-L${level}`,
    act(v, rng) {
      return decide(G.game, v.seat, { seat: v.seat, hole: v.hole, board: v.board }, v.pub, level, rng, cfg).action;
    },
  };
}
