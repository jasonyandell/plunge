// Page logic: you are South; North (partner), West and East are Walt.
import {
  SEAT_NAME, SUIT_CH, RANK_CH, suitOf, rankOf, makeRng, dealRandom, privateHand, newPublic,
  play, legal, toMove, isOver, heuristicBid, teamBid, P_TLEN, P_NTRICKS, P_WON, P_LEADER,
} from './engine.js';

const CFG = {
  fast: { level: 1, n: 32, n0: 3, horizon: 4, rollout: 'rule', bottom: 'random' },
  normal: { level: 1, n: 64, n0: 4, horizon: 4, rollout: 'rule', bottom: 'random' },
};
const TARGET = 500, FLOOR = -200;
const $ = (id) => document.getElementById(id);
const QUICK = new URLSearchParams(location.search).has('quick'); // test hook: no pauses
const sleep = (ms) => new Promise((r) => setTimeout(r, QUICK ? 0 : ms));
const seed0 = (crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0;
const rng = makeRng(seed0);

// ---------------------------------------------------------------- worker
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const { id } = e.data;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (e.data.error) p.reject(new Error(e.data.error));
  else p.resolve(e.data);
};
worker.onerror = (e) => console.error('worker error', e.message);
function askWalt(seat, hand, pub) {
  const id = ++reqId;
  const cfg = CFG[$('strength').value] || CFG.normal;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, seat, hand, pub: Array.from(pub), cfg, seed: rng.next() });
  });
}

// ---------------------------------------------------------------- state
const G = { score: [0, 0], bags: [0, 0], dealer: 3, hands: 0, ms: [], over: false };
let H = null; // current hand {deal, bids, pub, shown}

function cardEl(c, tag = 'div') {
  const el = document.createElement(tag);
  const s = suitOf(c);
  el.className = 'card' + (s === 1 || s === 2 ? ' red' : '');
  el.innerHTML = `<span>${RANK_CH[rankOf(c)]}</span><span class="su">${SUIT_CH[s]}</span>`;
  el.setAttribute('aria-label', RANK_CH[rankOf(c)] + ' of ' + ['clubs', 'diamonds', 'hearts', 'spades'][s]);
  return el;
}

function renderScore() {
  for (const t of [0, 1]) {
    $('sc' + t).textContent = G.score[t];
    $('bg' + t).textContent = 'bags ' + G.bags[t];
  }
  if (G.ms.length) {
    const m = G.ms.slice(-30);
    $('perf').textContent = `Walt ${$('strength').value}: ${Math.round(m.reduce((a, b) => a + b, 0) / m.length)} ms/move avg, ${Math.max(...m)} max (last ${m.length}).`;
  }
}

function renderSeats() {
  for (let s = 0; s < 4; s++) {
    const el = $('seat' + s);
    const bid = H && H.bids[s] != null ? H.bids[s] : '–';
    const won = H && H.pub ? H.won[s] : 0;
    el.querySelector('.info').textContent = `bid ${bid} · won ${won}`;
    el.classList.toggle('turn', !!(H && H.turn === s));
    const backs = el.querySelector('.backs');
    if (backs) {
      const n = H ? cardsLeft(s) : 0;
      backs.innerHTML = '<i></i>'.repeat(n);
    }
  }
}
function cardsLeft(s) {
  if (!H) return 0;
  const h = privateHand(H.deal, s, H.pub || newPublic(0, [0, 0, 0, 0]));
  let n = 0;
  for (const m of h) for (let x = m; x; x &= x - 1) n++;
  return n;
}

function renderTrick() {
  const t = $('trick');
  t.innerHTML = '';
  if (!H) return;
  for (const { seat, card } of H.shown) {
    const el = cardEl(card);
    el.classList.add('slot', 's' + seat);
    if (H.winSeat === seat) el.classList.add('win');
    t.appendChild(el);
  }
}

const DISPLAY_SUITS = [3, 2, 0, 1];
function renderHand(clickable = null) {
  const box = $('hand');
  box.innerHTML = '';
  if (!H) return;
  const h = privateHand(H.deal, 0, H.pub || newPublic(0, [0, 0, 0, 0]));
  for (const s of DISPLAY_SUITS) {
    for (let r = 12; r >= 0; r--) {
      if (!((h[s] >>> r) & 1)) continue;
      const c = s * 13 + r;
      const ok = clickable && clickable.has(c);
      const el = cardEl(c, 'button');
      el.type = 'button';
      if (clickable) el.classList.add(ok ? 'legal' : 'dim');
      if (ok) el.onclick = () => clickable.pick(c);
      else el.disabled = !!clickable;
      if (!clickable) el.tabIndex = -1;
      box.appendChild(el);
    }
  }
}

function setBar(msg, buttons = []) {
  const bar = $('bar');
  bar.innerHTML = '';
  const m = document.createElement('div');
  m.className = 'msg';
  m.id = 'msg';
  m.textContent = msg;
  bar.appendChild(m);
  for (const b of buttons) bar.appendChild(b);
}
function button(label, onclick, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = cls;
  b.onclick = onclick;
  return b;
}

// ---------------------------------------------------------------- flow
async function humanBid() {
  const sugg = heuristicBid(privateHand(H.deal, 0, newPublic(0, [0, 0, 0, 0])));
  return new Promise((resolve) => {
    const btns = [];
    for (let b = 1; b <= 13; b++) btns.push(button(String(b), () => resolve(b), b === sugg ? 'sugg' : ''));
    const partner = H.bids[2] != null ? ` North bid ${H.bids[2]}.` : '';
    setBar(`Your bid (suggested ${sugg}).${partner}`, btns);
  });
}

function humanCard() {
  const l = new Set(legal(privateHand(H.deal, 0, H.pub), H.pub));
  return new Promise((resolve) => {
    renderHand({ has: (c) => l.has(c), pick: (c) => resolve(c) });
    setBar(H.pub[P_TLEN] === 0 ? 'Your lead.' : 'Your play.');
  });
}

async function playHandUI() {
  G.dealer = (G.dealer + 1) & 3;
  G.hands++;
  H = { deal: dealRandom(rng), bids: [null, null, null, null], pub: null, shown: [], won: [0, 0, 0, 0], turn: -1, winSeat: -1 };
  renderHand();
  renderTrick();
  renderSeats();
  // bidding, starting left of the dealer
  for (let i = 1; i <= 4; i++) {
    const s = (G.dealer + i) & 3;
    H.turn = s;
    renderSeats();
    if (s === 0) H.bids[0] = await humanBid();
    else {
      setBar(`${SEAT_NAME[s]} is bidding…`);
      await sleep(350);
      H.bids[s] = heuristicBid(privateHand(H.deal, s, newPublic(0, [0, 0, 0, 0])));
    }
    renderSeats();
  }
  H.pub = newPublic((G.dealer + 1) & 3, H.bids);
  setBar(`Contracts: you + North ${teamBid(H.pub, 0)}, West + East ${teamBid(H.pub, 1)}.`);
  while (!isOver(H.pub)) {
    const seat = toMove(H.pub);
    H.turn = seat;
    renderSeats();
    if (H.shown.length === 4) {
      H.shown = [];
      H.winSeat = -1;
      renderTrick();
    }
    let card;
    if (seat === 0) card = await humanCard();
    else {
      setBar(`${SEAT_NAME[seat]} (Walt) is thinking…`);
      const t = performance.now();
      const hand = privateHand(H.deal, seat, H.pub); // only its own cards
      const r = await askWalt(seat, hand, H.pub);
      G.ms.push(r.ms);
      renderScore();
      const left = 450 - (performance.now() - t);
      if (left > 0) await sleep(left);
      card = r.card;
    }
    const before = H.pub[P_NTRICKS];
    H.pub = play(H.pub, card);
    H.shown.push({ seat, card });
    if (seat === 0) renderHand();
    if (H.pub[P_NTRICKS] > before) {
      H.winSeat = H.pub[P_LEADER]; // trick winner leads next
      H.won[H.winSeat]++;
      H.turn = -1;
      renderTrick();
      renderSeats();
      setBar(`${H.winSeat === 0 ? 'You win' : SEAT_NAME[H.winSeat] + ' wins'} the trick.`);
      await sleep(1100);
    } else renderTrick();
  }
  H.shown = [];
  H.winSeat = -1;
  renderTrick();
  return scoreHand();
}
function scoreHand() {
  const lines = [];
  for (const t of [0, 1]) {
    const bid = teamBid(H.pub, t), won = H.pub[P_WON + t];
    let delta;
    if (won >= bid) {
      const over = won - bid;
      delta = 10 * bid + over;
      G.bags[t] += over;
      if (G.bags[t] >= 10) {
        G.bags[t] -= 10;
        delta -= 100;
      }
    } else delta = -10 * bid;
    G.score[t] += delta;
    lines.push(`${t === 0 ? 'Us' : 'Them'} ${won}/${bid} → ${delta >= 0 ? '+' : ''}${delta}`);
  }
  renderScore();
  renderSeats();
  return lines.join(' · ');
}

async function game() {
  G.score = [0, 0];
  G.bags = [0, 0];
  G.hands = 0;
  renderScore();
  for (;;) {
    const summary = await playHandUI();
    const done = G.score.some((x) => x >= TARGET || x <= FLOOR);
    if (done) {
      const us = G.score[0], them = G.score[1];
      const res = us === them ? 'Tied game.' : us > them ? 'You win the game!' : 'Walt wins the game.';
      await new Promise((r) => setBar(`${summary}. ${res}`, [button('New game', r, 'primary')]));
      G.score = [0, 0];
      G.bags = [0, 0];
      renderScore();
    } else {
      await new Promise((r) => setBar(`Hand ${G.hands}: ${summary}`, [button('Next hand', r, 'primary')]));
    }
  }
}

window.addEventListener('error', (e) => setBar('Error: ' + e.message));
game().catch((e) => {
  console.error(e);
  setBar('Error: ' + e.message);
});
