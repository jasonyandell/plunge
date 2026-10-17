// Hearts vs Walt: page controller. South is the human; West, North and East
// are Walt seats whose moves come from the worker.
import * as E from './engine.js';
import { rulePass } from './bots.js';

export const WEB_SETTINGS = { level: 1, n: 48, n0: 6, horizon: 4, rollout: 'rule' };
const TARGET = 100;
const NAMES = ['You', 'West', 'North', 'East'];
const PASS_NAMES = ['left', 'right', 'across', 'hold'];
const PASS_OFF = [1, 3, 2, 0];

const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const r = pending.get(e.data.id);
  if (r) { pending.delete(e.data.id); r(e.data); }
};
worker.onerror = (e) => setStatus('Worker error: ' + (e.message || e));

const G = {
  scores: [0, 0, 0, 0], history: [], handNo: 0, deal: null, pub: null, pins: null,
  phase: 'idle', selected: new Set(), received: new Set(), trick: [], lastTrick: null,
  lastMs: [], allMs: [], token: 0, humanResolve: null, gameOver: false,
};

function rnd32() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}
const FAST = new URLSearchParams(location.search).has('fast'); // test hook: no animation pauses
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? 0 : ms));

function cardEl(c, extra = '') {
  const s = (c / 13) | 0;
  const el = document.createElement('div');
  el.className = 'card' + (s === E.HE || s === E.DI ? ' red' : '') + (extra ? ' ' + extra : '');
  el.innerHTML = `<span>${E.RANK_SYM[c % 13]}</span><span class="s">${E.SUIT_SYM[s]}</span>`;
  el.dataset.card = c;
  return el;
}
function setStatus(t) { $('status').textContent = t; }

function handOf(seat) {
  return G.pub ? E.privateHand(G.deal, seat, G.pub) : [...G.deal.subarray(seat * 4, seat * 4 + 4)];
}
function cardsOf(h) {
  const r = [];
  for (const s of [E.CL, E.DI, E.SP, E.HE]) for (let b = 0; b < 13; b++) if (h[s] & (1 << b)) r.push(s * 13 + b);
  return r;
}

// ------------------------------------------------------------ rendering
function renderScores() {
  const min = Math.min(...G.scores);
  let html = '<tr><th></th>' + NAMES.map((n, i) => `<th>${n}${i ? ' <small>(Walt)</small>' : ''}</th>`).join('') + '</tr>';
  html += '<tr class="lead"><td>Total</td>' + G.scores.map((s) => `<td>${s}${G.history.length && s === min ? ' ★' : ''}</td>`).join('') + '</tr>';
  if (G.history.length) {
    const h = G.history[G.history.length - 1];
    html += `<tr><td>Hand ${G.history.length}</td>` + h.map((x) => `<td>${x}</td>`).join('') + '</tr>';
  }
  $('scores').innerHTML = html;
}

function renderInfo() {
  const p = G.pub;
  const pts = p ? [0, 1, 2, 3].map((s) => p[E.PTS + s]) : [0, 0, 0, 0];
  const broken = p && p[E.BROKEN];
  const ms = G.lastMs.length ? Math.round(G.lastMs.reduce((a, b) => a + b, 0) / G.lastMs.length) : null;
  $('info').innerHTML =
    `<span>Hand <b>${G.handNo + 1}</b> · pass <b>${PASS_NAMES[G.handNo % 4]}</b></span>` +
    `<span class="pill ${broken ? 'on' : ''}">${broken ? 'hearts broken' : 'hearts not broken'}</span>` +
    `<span>this hand: ${pts.map((x, i) => `${NAMES[i]} <b>${x}</b>`).join(' · ')}</span>` +
    (ms !== null ? `<span>Walt ~${ms} ms/move</span>` : '');
}

function renderTable() {
  const toMove = G.pub && G.phase === 'play' ? G.pub[E.TOMOVE] : -1;
  for (let s = 0; s < 4; s++) {
    const n = G.pub ? E.handSize(G.pub, s) : 13;
    $('seat' + s).className = 'seat ' + 'swne'[s] + (s === toMove ? ' turn' : '');
    $('seat' + s).innerHTML = `<b>${NAMES[s]}${s ? ' · Walt' : ''}</b>${s ? n + ' cards' : ''}`;
    $('slot' + s).innerHTML = '';
  }
  let win = -1;
  if (G.trick.length === 4) win = trickWinner(G.trick);
  for (const { seat, card } of G.trick) $('slot' + seat).appendChild(cardEl(card, seat === win ? 'win' : ''));
}

function trickWinner(t) {
  const led = (t[0].card / 13) | 0;
  let best = t[0];
  for (const x of t) if (((x.card / 13) | 0) === led && x.card % 13 > best.card % 13) best = x;
  return best.seat;
}

function renderHand() {
  const el = $('hand');
  el.innerHTML = '';
  if (!G.deal) return;
  const h = handOf(0);
  let legal = new Set();
  if (G.phase === 'play' && G.pub[E.TOMOVE] === 0 && G.humanResolve) legal = new Set(E.legalCards(h, 0, G.pub));
  for (const c of cardsOf(h)) {
    let cls = '';
    if (G.phase === 'pass') cls = 'legal' + (G.selected.has(c) ? ' sel' : '');
    else if (legal.has(c)) cls = 'legal';
    if (G.received.has(c)) cls += ' recv';
    const ce = cardEl(c, cls);
    ce.onclick = () => onCard(c);
    el.appendChild(ce);
  }
}

function renderLast() {
  const el = $('last');
  el.innerHTML = '';
  if (!G.lastTrick) return;
  const w = trickWinner(G.lastTrick);
  el.append('Last trick: ');
  for (const { seat, card } of G.lastTrick) {
    const span = document.createElement('span');
    span.textContent = NAMES[seat][0];
    el.append(span, cardEl(card, seat === w ? 'win' : ''));
  }
  el.append(` → ${NAMES[w]}`);
}

function renderActions(buttons) {
  const el = $('actions');
  el.innerHTML = '';
  for (const [label, fn, disabled] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = !!disabled;
    b.onclick = fn;
    el.appendChild(b);
  }
}

function renderAll() {
  renderScores(); renderInfo(); renderTable(); renderHand(); renderLast();
}

// --------------------------------------------------------------- flow
function onCard(c) {
  if (G.phase === 'pass') {
    if (G.selected.has(c)) G.selected.delete(c);
    else if (G.selected.size < 3) G.selected.add(c);
    renderHand();
    renderPassButton();
    return;
  }
  if (G.phase === 'play' && G.humanResolve) {
    const legal = E.legalCards(handOf(0), 0, G.pub);
    if (!legal.includes(c)) { setStatus(illegalReason(c)); return; }
    const r = G.humanResolve;
    G.humanResolve = null;
    r(c);
  }
}

function illegalReason(c) {
  const p = G.pub, s = (c / 13) | 0;
  if (p[E.NPLAYED] === 0) return 'The 2♣ leads the first trick.';
  if (p[E.TC] > 0) {
    const led = (p[E.TRICK] / 13) | 0;
    if (s !== led) return `You must follow ${E.SUIT_SYM[led]}.`;
    return 'No points on the first trick.';
  }
  if (s === E.HE) return 'Hearts are not broken yet.';
  return 'Not a legal card.';
}

function renderPassButton() {
  const dir = PASS_NAMES[G.handNo % 4];
  renderActions([[`Pass 3 ${dir}`, doPass, G.selected.size !== 3]]);
}

function newGame() {
  G.token++;
  G.scores = [0, 0, 0, 0]; G.history = []; G.handNo = 0; G.gameOver = false;
  G.lastMs = [];
  startHand();
}

function startHand() {
  G.token++;
  G.deal = E.randomDeal(new E.Rng(rnd32()));
  G.pub = null; G.trick = []; G.lastTrick = null; G.selected = new Set(); G.received = new Set();
  G.pins = [null, null, null, null];
  G.humanResolve = null;
  if (G.handNo % 4 === 3) {
    G.phase = 'play';
    beginPlay();
    return;
  }
  G.phase = 'pass';
  renderAll();
  setStatus(`Choose 3 cards to pass ${PASS_NAMES[G.handNo % 4]} (to ${NAMES[PASS_OFF[G.handNo % 4]]}).`);
  renderPassButton();
}

function doPass() {
  const off = PASS_OFF[G.handNo % 4];
  const passes = [[...G.selected]];
  for (let s = 1; s < 4; s++) passes.push(rulePass(G.deal.subarray(s * 4, s * 4 + 4)));
  const d = G.deal.slice();
  for (let s = 0; s < 4; s++) for (const c of passes[s]) d[s * 4 + ((c / 13) | 0)] &= ~(1 << c % 13);
  G.pins = [0, 1, 2, 3].map(() => new Int32Array(16));
  for (let s = 0; s < 4; s++) {
    const to = (s + off) & 3;
    for (const c of passes[s]) {
      d[to * 4 + ((c / 13) | 0)] |= 1 << c % 13;
      G.pins[s][to * 4 + ((c / 13) | 0)] |= 1 << c % 13;
    }
  }
  G.received = new Set(passes[(4 - off) & 3]);
  G.deal = d;
  G.phase = 'play';
  beginPlay();
}

async function beginPlay() {
  const token = G.token;
  G.pub = E.newPublic(E.seatOf2C(G.deal));
  renderActions([]);
  renderAll();
  while (token === G.token && !E.isDone(G.pub)) {
    const seat = G.pub[E.TOMOVE];
    let card;
    if (seat === 0) {
      setStatus(G.pub[E.TC] === 0 ? 'Your lead.' : 'Your play.');
      card = await new Promise((r) => { G.humanResolve = r; renderAll(); });
    } else {
      setStatus(`${NAMES[seat]} is thinking…`);
      renderTable();
      const t0 = performance.now();
      card = await askWalt(seat);
      const wait = 350 - (performance.now() - t0);
      if (wait > 0) await sleep(wait);
    }
    if (token !== G.token) return;
    G.received.delete(card);
    G.trick.push({ seat, card });
    G.pub = E.play(G.pub, card);
    renderAll();
    if (G.trick.length === 4) {
      setStatus(`${NAMES[trickWinner(G.trick)]} ${trickWinner(G.trick) ? 'takes' : 'take'} the trick.`);
      await sleep(1000);
      if (token !== G.token) return;
      G.lastTrick = G.trick;
      G.trick = [];
      renderAll();
    }
  }
  if (token === G.token) endHand();
}

function askWalt(seat) {
  const id = ++reqId;
  return new Promise((resolve) => {
    pending.set(id, (r) => { G.lastMs.push(r.ms); G.allMs.push(r.ms); if (G.lastMs.length > 40) G.lastMs.shift(); resolve(r.card); });
    worker.postMessage({
      id, seat, hand: handOf(seat), pub: [...G.pub], pins: G.pins[seat] ? [...G.pins[seat]] : null,
      settings: WEB_SETTINGS, seed: rnd32(),
    });
  });
}

function endHand() {
  const pts = [0, 1, 2, 3].map((s) => E.payoff(G.pub, s));
  const moon = [0, 1, 2, 3].find((s) => G.pub[E.PTS + s] === 26);
  for (let s = 0; s < 4; s++) G.scores[s] += pts[s];
  G.history.push(pts);
  G.phase = 'idle';
  renderAll();
  let msg = moon !== undefined ? `${NAMES[moon]} shot the moon! ` : '';
  msg += 'Hand over: ' + pts.map((x, i) => `${NAMES[i]} ${x}`).join(', ') + '.';
  if (Math.max(...G.scores) >= TARGET) {
    const min = Math.min(...G.scores);
    const winners = [0, 1, 2, 3].filter((s) => G.scores[s] === min).map((s) => NAMES[s]);
    msg += ` Game over — ${winners.join(' & ')} ${winners.length === 1 && winners[0] === 'You' ? 'win' : 'wins'} with ${min}.`;
    G.gameOver = true;
    renderActions([['New game', newGame]]);
  } else {
    renderActions([['Next hand', () => { G.handNo++; startHand(); }]]);
  }
  setStatus(msg);
}

$('newGame').onclick = newGame;
$('settings').textContent =
  `Walt settings: level ${WEB_SETTINGS.level}, n = ${WEB_SETTINGS.n} deals, n0 = ${WEB_SETTINGS.n0} per modeled mind, ` +
  `horizon ${WEB_SETTINGS.horizon} plays, ${WEB_SETTINGS.rollout}-based rollout beyond it.`;
window.__hearts = G; // for automated end-to-end checks
newGame();
