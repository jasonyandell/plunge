// Page controller: holds the true deal, shows South's cards, and asks the
// worker (Walt) for every other seat, sending only that seat's holding + the
// public record.
import * as G from './engine.js';

const $ = (id) => document.getElementById(id);
const STRENGTH = {
  fast: { level: 1, n: 12, n0: 6 },
  normal: { level: 1, n: 24, n0: 8 },
  strong: { level: 1, n: 40, n0: 10 },
};
const TARGET = 10;
const QUICK = new URLSearchParams(location.search).has('quick'); // automated tests
const AI_PAUSE = QUICK ? 0 : 450, TRICK_PAUSE = QUICK ? 0 : 1300;

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map();
worker.onmessage = (ev) => {
  const { id, action, ms } = ev.data;
  const res = pending.get(id);
  if (res) { pending.delete(id); res({ action, ms }); }
};
worker.onerror = (e) => { log('AI worker error: ' + (e.message || e)); };
function askWalt(seat, priv, pub) {
  const id = ++reqId;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const cfg = STRENGTH[$('strength').value] ?? STRENGTH.normal;
  return new Promise((res) => { pending.set(id, res); worker.postMessage({ id, seat, priv, pub, seed, cfg }); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

let game, hand, gen = 0; // gen invalidates stale loops after "New game"
let humanResolve = null;
const aiTimes = []; // per-move Walt timings (shown in footer, read by tests)

function newGame() {
  gen++;
  game = { score: [0, 0], dealer: rand32() & 3, over: false };
  $('log').innerHTML = '';
  startHand(gen);
}

function startHand(g) {
  const { deal, up } = G.randomDeal(G.rngFrom(rand32()));
  hand = { deal, pub: G.newPublic(game.dealer, up), bubbles: ['', '', '', ''], shown: null, result: null };
  log(`${G.SEAT_NAME[game.dealer]} deals; ${cardText(up)} turned up.`);
  render();
  loop(g);
}

async function loop(g) {
  while (g === gen) {
    const pub = hand.pub;
    if (pub.phase === G.DONE) { finishHand(g); return; }
    const seat = pub.turn;
    let a;
    if (seat === 0) {
      a = await new Promise((res) => { humanResolve = res; render(); });
      humanResolve = null;
    } else {
      render();
      const priv = G.privateOf(hand.deal, seat, pub);
      const opts = G.legal(priv, pub);
      if (opts.length === 1) { a = opts[0]; await sleep(AI_PAUSE); } else {
        const t0 = performance.now();
        const r = await askWalt(seat, priv, pub);
        a = r.action;
        $('timing').textContent = `last Walt move: ${r.ms} ms`;
        aiTimes.push({ ms: r.ms, phase: pub.phase });
        const left = AI_PAUSE - (performance.now() - t0);
        if (left > 0) await sleep(left);
      }
    }
    if (g !== gen) return;
    await apply(seat, a, g);
  }
}

async function apply(seat, a, g) {
  const pub = hand.pub;
  const name = G.SEAT_NAME[seat];
  if (pub.phase === G.BID1) {
    const isDealer = seat === pub.dealer;
    hand.bubbles[seat] = a ? (isDealer ? 'Picks up' : 'Order up') : 'Pass';
    log(`${name}: ${a ? (isDealer ? 'picks it up' : 'orders it up') : 'passes'}`);
  } else if (pub.phase === G.DISCARD) {
    hand.deal = G.applyHidden(hand.deal, pub, a);
    log(`${name} discards${seat === 0 ? ' ' + cardText(a) : ' (face down)'}.`);
  } else if (pub.phase === G.BID2) {
    hand.bubbles[seat] = a ? G.SUIT_SYM[a - 1] + ' ' + G.SUIT_NAME[a - 1] : 'Pass';
    log(`${name}: ${a ? 'names ' + G.SUIT_NAME[a - 1] : 'passes'}`);
  }
  const before = pub;
  hand.pub = G.play(pub, a);
  const now = hand.pub;
  if (before.phase === G.BID1 && now.phase === G.BID2) {
    hand.bubbles = ['', '', '', ''];
    log(`All pass; ${cardText(before.up)} turned down.`);
  }
  if ((before.phase === G.BID1 || before.phase === G.BID2) && now.maker >= 0) {
    hand.bubbles = ['', '', '', ''];
    hand.bubbles[now.maker] = 'Maker';
    log(`Trump ${G.SUIT_SYM[now.trump]} ${G.SUIT_NAME[now.trump]}, made by ${G.SEAT_NAME[now.maker]}.`);
  }
  if (before.phase === G.PLAY) {
    if (now.tl === 0) {
      // trick complete: show it before clearing
      const cards = [0, 1, 2, 3].map((i) => (i < 3 ? G.trickCard(before, i) : a));
      const w = G.trickWinner(before.leader, cards, before.trump);
      hand.shown = { leader: before.leader, cards, winner: w };
      log(`Trick ${now.trick}: ${cards.map((c, i) => G.SEAT_NAME[(before.leader + i) & 3][0] + ' ' + cardText(c)).join(', ')} → ${G.SEAT_NAME[w]}`);
      render();
      await sleep(TRICK_PAUSE);
      if (g !== gen) return;
      hand.shown = null;
    }
  }
  render();
}

function finishHand(g) {
  const pub = hand.pub;
  const pay = G.outcome(pub);
  if (pub.maker < 0) {
    log('Everyone passed again: redeal.');
    hand.result = 'All passed — redeal.';
  } else {
    const mk = pub.maker & 1;
    const mt = mk ? pub.t1 : pub.t0;
    const team = (t) => (t === 0 ? 'Us' : 'Them');
    if (pay > 0) game.score[0] += pay; else game.score[1] -= pay;
    const what = mt === 5 ? `March! ${team(mk)} +2` : mt >= 3 ? `${team(mk)} made it: +1` : `Euchred! ${team(1 - mk)} +2`;
    hand.result = `${what} (makers took ${mt} trick${mt === 1 ? '' : 's'})`;
    log(hand.result);
  }
  game.dealer = (game.dealer + 1) & 3;
  if (game.score[0] >= TARGET || game.score[1] >= TARGET) {
    game.over = true;
    hand.result += game.score[0] >= TARGET ? ' — You and North win the game!' : ' — West and East win the game.';
  }
  render();
}

// ---- rendering --------------------------------------------------------------
const isRed = (c) => G.suitOf(c) === 1 || G.suitOf(c) === 3;
function cardText(c) { return G.RANK_SYM[G.rankOf(c)] + G.SUIT_SYM[G.suitOf(c)]; }
function cardEl(c, cls = '') {
  const d = document.createElement('div');
  d.className = `card ${isRed(c) ? 'red' : ''} ${cls}`;
  d.innerHTML = `<span>${G.RANK_SYM[G.rankOf(c)]}</span><span class="su">${G.SUIT_SYM[G.suitOf(c)]}</span>`;
  d.setAttribute('aria-label', cardText(c));
  return d;
}
function button(label, fn, cls = '') {
  const b = document.createElement('button');
  b.textContent = label; b.className = cls;
  b.onclick = fn;
  return b;
}
function log(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  const L = $('log');
  L.prepend(d);
}

function render() {
  const pub = hand.pub;
  $('scoreUs').textContent = game.score[0];
  $('scoreThem').textContent = game.score[1];
  // info line
  const info = [`Dealer <b>${G.SEAT_NAME[pub.dealer]}</b>`];
  if (pub.trump < 4) {
    info.push(`Trump <b>${G.SUIT_SYM[pub.trump]} ${G.SUIT_NAME[pub.trump]}</b>`);
    info.push(`Maker <b>${G.SEAT_NAME[pub.maker]}</b> (${pub.maker & 1 ? 'Them' : 'Us'})`);
    info.push(`Tricks Us <b>${pub.t0}</b> · Them <b>${pub.t1}</b>`);
  } else info.push(`Up card <b>${cardText(pub.up)}</b>`);
  $('info').innerHTML = info.map((x) => `<span>${x}</span>`).join('');
  // seats
  for (let s = 0; s < 4; s++) {
    const el = $('seat' + s);
    el.classList.toggle('turn', pub.phase !== G.DONE && pub.turn === s && !hand.shown);
    el.querySelector('.bubble').textContent = hand.bubbles[s];
    const backs = el.querySelector('.backs');
    if (backs) {
      const n = pub.phase === G.DONE ? 0 : G.popcount(G.privateOf(hand.deal, s, pub) & G.HAND_MASK);
      backs.innerHTML = '<i></i>'.repeat(n);
    }
  }
  // center: trick or up card
  const center = $('center');
  center.innerHTML = '';
  if (hand.shown) {
    hand.shown.cards.forEach((c, i) => {
      const s = (hand.shown.leader + i) & 3;
      const slot = document.createElement('div');
      slot.className = 'slot s' + s;
      slot.append(cardEl(c, s === hand.shown.winner ? 'win' : ''));
      center.append(slot);
    });
  } else if (pub.phase === G.PLAY || pub.phase === G.DONE) {
    for (let i = 0; i < pub.tl; i++) {
      const s = (pub.leader + i) & 3;
      const slot = document.createElement('div');
      slot.className = 'slot s' + s;
      slot.append(cardEl(G.trickCard(pub, i)));
      center.append(slot);
    }
  } else {
    const mid = document.createElement('div');
    mid.className = 'slot mid';
    const up = pub.phase === G.BID2 ? cardEl(pub.up, 'down') : cardEl(pub.up);
    mid.append(up);
    const cap = document.createElement('div');
    cap.textContent = pub.phase === G.BID2 ? 'turned down' : pub.phase === G.DISCARD ? 'dealer picks up' : 'up card';
    mid.append(cap);
    center.append(mid);
  }
  // south hand
  const myPriv = G.privateOf(hand.deal, 0, pub);
  const myTurn = humanResolve && pub.turn === 0 && pub.phase !== G.DONE;
  const legalCards = myTurn && (pub.phase === G.PLAY || pub.phase === G.DISCARD) ? G.legal(myPriv, pub) : [];
  const handEl = $('hand');
  handEl.innerHTML = '';
  const t = pub.trump < 4 ? pub.trump : G.suitOf(pub.up);
  const mine = G.cardsOf(myPriv & G.HAND_MASK).sort((a, b) => sortKey(a, t) - sortKey(b, t));
  for (const c of mine) {
    const ok = legalCards.includes(c);
    const el = cardEl(c, ok ? 'legal' : legalCards.length ? 'dim' : '');
    if (ok) el.onclick = () => { const r = humanResolve; if (r) r(c); };
    handEl.append(el);
  }
  // prompt + actions
  const acts = $('actions');
  acts.innerHTML = '';
  let prompt = '';
  if (pub.phase === G.DONE) {
    prompt = hand.result ?? '';
    if (game.over) acts.append(button('New game', newGame));
    else acts.append(button(pub.maker < 0 ? 'Redeal' : 'Next hand', () => startHand(gen)));
  } else if (myTurn) {
    if (pub.phase === G.BID1) {
      const isDealer = pub.dealer === 0;
      prompt = `Make ${G.SUIT_SYM[G.suitOf(pub.up)]} ${G.SUIT_NAME[G.suitOf(pub.up)]} trump?`;
      acts.append(button(isDealer ? `Pick it up` : (pub.dealer === 2 ? 'Order up (partner picks up)' : 'Order it up'), () => humanResolve(1)));
      acts.append(button('Pass', () => humanResolve(0), 'secondary'));
    } else if (pub.phase === G.BID2) {
      prompt = 'Name a trump suit, or pass.';
      for (let s = 0; s < 4; s++) if (s !== G.suitOf(pub.up)) acts.append(button(`${G.SUIT_SYM[s]} ${G.SUIT_NAME[s]}`, () => humanResolve(1 + s)));
      acts.append(button('Pass', () => humanResolve(0), 'secondary'));
    } else if (pub.phase === G.DISCARD) prompt = 'You picked up the card: tap a card to discard.';
    else prompt = pub.tl === 0 ? 'Your lead.' : 'Your play.';
  } else if (!hand.shown) prompt = `${G.SEAT_NAME[pub.turn]} is thinking…`;
  $('prompt').textContent = prompt;
}

function sortKey(c, t) {
  // group by effective suit (trump last), rank within
  const e = G.EFF[t][c];
  const grp = e === t ? 9 : [0, 1, 2, 3].filter((s) => s !== t).indexOf(e) + 1;
  return grp * 100 + (G.POW[t][c] || G.rankOf(c));
}

$('newGame').onclick = newGame;
newGame();

// test hook for automated end-to-end checks
window.__euchre = { aiTimes, get state() { return { game, pub: hand.pub, waiting: !!humanResolve }; } };
