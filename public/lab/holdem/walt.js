// Walt (lab/WALT-CARD.md) for games whose hidden thing is the deal, with the
// chip-payoff generalization: `value` returns the decider's net chips summed
// over its deals (exact integers), and chance reveals (board cards) split the
// decider's deals into the information sets it can tell apart.
//
// cfg = { n, n0, horizon, horizon0, branch, branch0 }
//   n / horizon / branch:     the live decider's worlds, street horizon, board branching
//   n0 / horizon0 / branch0:  the same for every modeled mind (nested decides)
// Beyond the horizon the hand is checked down to showdown (a cheap rollout).

export function decide(game, seat, priv, pub, level, rng, cfg, top = true) {
  const options = game.legal(pub);
  if (options.length === 1) return { action: options[0], values: null, n: 0 };
  const n = top ? cfg.n : cfg.n0;
  const horizon = top ? cfg.horizon : cfg.horizon0;
  const branch = top ? cfg.branch : cfg.branch0;
  const deals = game.sample(seat, priv, pub, n, horizon, branch, rng);
  const ctx = { game, me: seat, level, rng, cfg, last: pub.street + horizon, memo: new Map(), stats: top ? { minds: 0 } : null };
  let best = -Infinity, action = options[0];
  const values = [];
  for (const a of options) {
    const v = value(ctx, game.play(pub, a), deals, true);
    values.push(v);
    if (v > best) { best = v; action = a; } // first maximum, as in the card's max()
  }
  return { action, values, options, n: deals.length, stats: ctx.stats };
}

function value(ctx, pub, deals, split) {
  const { game, me } = ctx;
  if (game.isTerminal(pub)) return game.payoffSum(deals, me, pub);
  if (pub.fresh && split) {
    if (pub.street > ctx.last) return game.rolloutSum(deals, me, pub);
    // A board card was dealt: deals with different boards are different
    // information sets for every seat, so value each group separately.
    const groups = new Map();
    for (const d of deals) {
      const k = game.boardKey(d, pub.street);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(d);
    }
    let s = 0;
    for (const g of groups.values()) s += value(ctx, pub, g, false);
    return s;
  }
  const seat = game.toMove(pub);
  const options = game.legal(pub);
  if (seat === me) { // one action for every deal I can't tell apart
    let best = -Infinity;
    for (const a of options) {
      const v = value(ctx, game.play(pub, a), deals, true);
      if (v > best) best = v;
    }
    return best;
  }
  // What does `seat` do in each deal? Bottom rung: random legal. Otherwise a
  // nested decide from its own chair (its holding + the public record only).
  const groups = new Array(3);
  for (const d of deals) {
    let a;
    if (ctx.level === 0) a = options[ctx.rng.int(options.length)];
    else {
      const key = game.privKey(d, seat, pub);
      a = ctx.memo.get(key);
      if (a === undefined) {
        a = decide(game, seat, game.privateOf(d, seat, pub), pub, ctx.level - 1, ctx.rng, ctx.cfg, false).action;
        ctx.memo.set(key, a);
        if (ctx.stats) ctx.stats.minds++;
      }
    }
    (groups[a] || (groups[a] = [])).push(d);
  }
  let s = 0;
  for (let a = 0; a < 3; a++) if (groups[a]) s += value(ctx, game.play(pub, a), groups[a], true);
  return s;
}
