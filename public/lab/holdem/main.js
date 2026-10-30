// Page controller: a human against Walt, heads-up limit hold'em.
import { Rng, cardRank, cardSuit, RANKS, score7, CATEGORY_NAMES } from './cards.js';
import * as G from './game.js';
import { LIVE_LEVEL, LIVE_CFG } from './config.js';

const START = (() => { const v = parseInt(new URLSearchParams(location.search).get('start') || '200', 10); return v >= 48 && v <= 100000 ? v : 200; })();
const $ = (id) => document.getElementById(id);
const SUIT_GLYPH = ['♣', '♦', '♥', '♠'];
const STREETS = ['Preflop', 'Flop', 'Turn', 'River'];

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let pending = null, reqId = 0;
worker.onmessage = (e) => { if (pending && e.data.id === pending.id) { const p = pending; pending = null; p.resolve(e.data); } };
function askWalt(msg) { return new Promise((resolve) => { pending = { id: ++reqId, resolve }; worker.postMessage({ ...msg, id: reqId }); }); }

function seed32() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }

const S = { stacks: { you: START, walt: START }, handNo: 0, human: 0, cards: null, pub: null, busy: false, rng: new Rng(seed32()), log: [], over: false, inHand: false };

function cardEl(c, cls = '') {
  const d = document.createElement('div');
  if (c === null) { d.className = 'pc back ' + cls; return d; }
  if (c === undefined) { d.className = 'pc empty'; return d; }
  const s = cardSuit(c);
  d.className = 'pc ' + (s === 1 || s === 2 ? 'red ' : '') + cls;
  d.innerHTML = `<span>${RANKS[cardRank(c)].replace('T', '10')}</span><span class="s">${SUIT_GLYPH[s]}</span>`;
  d.setAttribute('aria-label', RANKS[cardRank(c)] + ' of ' + ['clubs', 'diamonds', 'hearts', 'spades'][s]);
  return d;
}
const human = () => S.human, walt = () => 1 - S.human;
const contrib = (pub, seat) => (seat === 0 ? pub.c0 : pub.c1);

function render(reveal = false, winners = null) {
  const pub = S.pub, cards = S.cards;
  const h = human(), w = walt();
  const committed = (seat) => (pub ? contrib(pub, seat) : 0);
  $('youStack').textContent = `${S.stacks.you - (S.inHand ? committed(h) : 0)} chips`;
  $('waltStack').textContent = `${S.stacks.walt - (S.inHand ? committed(w) : 0)} chips`;
  $('youBtn').innerHTML = S.cards ? (h === 0 ? '<span class="badge">button · SB</span>' : '<span class="badge">BB</span>') : '';
  $('waltBtn').innerHTML = S.cards ? (w === 0 ? '<span class="badge">button · SB</span>' : '<span class="badge">BB</span>') : '';
  const yc = $('youCards'), wc = $('waltCards'), bd = $('board');
  yc.replaceChildren(); wc.replaceChildren(); bd.replaceChildren();
  if (cards) {
    yc.append(cardEl(cards[2 * h], winners && winners.has(h) ? 'win' : ''), cardEl(cards[2 * h + 1], winners && winners.has(h) ? 'win' : ''));
    if (reveal) wc.append(cardEl(cards[2 * w], winners && winners.has(w) ? 'win' : ''), cardEl(cards[2 * w + 1], winners && winners.has(w) ? 'win' : ''));
    else wc.append(cardEl(null), cardEl(null));
    const nb = pub ? G.BOARD_VISIBLE[Math.min(pub.street, 4)] : 0;
    const shown = pub && pub.done && pub.folded < 0 ? 5 : nb;
    for (let i = 0; i < 5; i++) bd.append(cardEl(i < shown ? cards[4 + i] : undefined));
  } else {
    for (let i = 0; i < 5; i++) bd.append(cardEl(undefined));
  }
  if (pub) {
    $('pot').textContent = `Pot ${pub.c0 + pub.c1}`;
    $('youBet').textContent = S.inHand ? `You have ${committed(h)} in` : '';
    $('waltBet').textContent = S.inHand ? `Walt has ${committed(w)} in` : '';
  } else { $('pot').textContent = ''; $('youBet').textContent = ''; $('waltBet').textContent = ''; }
  $('log').textContent = S.log.join('\n');
  $('log').scrollTop = 1e9;
}

function setControls() {
  const pub = S.pub;
  const myTurn = S.inHand && !S.busy && pub && !pub.done && pub.actor === human();
  const opts = myTurn ? G.legal(pub) : [];
  const facing = pub && (pub.actor === 0 ? pub.c1 > pub.c0 : pub.c0 > pub.c1);
  const size = pub && pub.street < 4 ? G.BET_SIZE[pub.street] : 0;
  const toCall = pub ? Math.abs(pub.c0 - pub.c1) : 0;
  $('bFold').disabled = !opts.includes(G.FOLD);
  $('bCall').disabled = !opts.includes(G.CALL);
  $('bRaise').disabled = !opts.includes(G.RAISE);
  $('bCall').textContent = facing ? `Call ${toCall}` : 'Check';
  $('bRaise').textContent = !size ? 'Bet' : facing ? `Raise ${toCall + size}` : `Bet ${size}`;
  $('bNext').disabled = S.inHand || S.over;
  $('bNext').textContent = S.handNo === 0 ? 'Deal' : 'Next hand';
}

const verb = (pub, a, you = false) => {
  const facing = pub.actor === 0 ? pub.c1 > pub.c0 : pub.c0 > pub.c1;
  const w = a === G.FOLD ? 'fold' : a === G.CALL ? (facing ? 'call' : 'check') : (facing ? 'raise' : 'bet');
  return you ? w : w + 's';
};

function applyAction(a) {
  const pub = S.pub, who = pub.actor === human() ? 'You' : 'Walt';
  S.log.push(`  ${who} ${verb(pub, a, who === 'You')}`);
  const next = G.play(pub, a);
  S.pub = next;
  if (next.fresh) {
    const c = S.cards;
    const shown = next.street === 1 ? [c[4], c[5], c[6]] : [c[5 + next.street]];
    S.log.push(`${STREETS[next.street]}: ${shown.map(name).join(' ')}  (pot ${next.c0 + next.c1})`);
  }
}
function name(c) { return RANKS[cardRank(c)] + SUIT_GLYPH[cardSuit(c)]; }

async function loop() {
  while (S.inHand && !S.pub.done) {
    if (S.pub.actor === human()) { S.busy = false; setControls(); $('msg').textContent = 'Your move.'; render(); return; }
    S.busy = true; setControls();
    $('msg').textContent = 'Walt is thinking'; $('msg').className = 'msg thinking';
    const w = walt(), c = S.cards, pub = S.pub;
    const t0 = performance.now();
    const r = await askWalt({ seat: w, hole: [c[2 * w], c[2 * w + 1]], board: Array.from(c.subarray(4, 4 + G.BOARD_VISIBLE[pub.street])), pub, level: LIVE_LEVEL, cfg: LIVE_CFG, seed: S.rng.next() });
    const wait = 450 - (performance.now() - t0);
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    $('msg').className = 'msg';
    showWhy(pub, r);
    applyAction(r.action);
    render();
  }
  finishHand();
}

function showWhy(pub, r) {
  if (!r.values) { $('why').textContent = `Only one legal action (${verb(pub, r.action)}).`; return; }
  const label = (a) => { const v = verb(pub, a); return v[0].toUpperCase() + v.slice(1); };
  const parts = r.options.map((a, i) => {
    const per = r.values[i] / r.n; // display only
    return `${label(a)} ${per >= 0 ? '+' : ''}${per.toFixed(2)}`;
  });
  $('why').textContent = `${STREETS[pub.street]}: ${parts.join(' · ')} chips per deal over ${r.n} sampled deals (${r.minds} modeled decisions of yours, ${r.ms} ms). Chose: ${label(r.action).toLowerCase()}.`;
}

function finishHand() {
  const pub = S.pub, c = S.cards, h = human();
  const sd = G.showdownSign(c);
  const net = G.payoff(pub, h, sd);
  S.stacks.you += net; S.stacks.walt -= net;
  let winners = null;
  if (pub.folded >= 0) {
    $('msg').textContent = pub.folded === h ? `You fold. Walt wins ${pub.c0 + pub.c1}.` : `Walt folds. You win ${pub.c0 + pub.c1}.`;
    S.log.push(pub.folded === h ? `Walt wins ${pub.c0 + pub.c1}` : `You win ${pub.c0 + pub.c1}`);
  } else {
    const b = c.subarray(4, 9);
    const sh = score7(c[2 * h], c[2 * h + 1], b), sw = score7(c[2 * (1 - h)], c[2 * (1 - h) + 1], b);
    const hn = CATEGORY_NAMES[sh >> 20], wn = CATEGORY_NAMES[sw >> 20];
    const winSeat = sd === 0 ? -1 : sd > 0 ? 0 : 1;
    winners = new Set(sd === 0 ? [0, 1] : [winSeat]);
    const text = sd === 0 ? `Split pot: both ${hn.toLowerCase()}.` : winSeat === h ? `You win ${pub.c0 + pub.c1} with ${hn.toLowerCase()} (Walt: ${wn.toLowerCase()}).` : `Walt wins ${pub.c0 + pub.c1} with ${wn.toLowerCase()} (you: ${hn.toLowerCase()}).`;
    $('msg').textContent = text;
    S.log.push(`Showdown: Walt ${name(c[2 * (1 - h)])} ${name(c[2 * (1 - h) + 1])} — ${text}`);
  }
  S.inHand = false; S.busy = false;
  if (S.stacks.you < G.MAX_LOSS || S.stacks.walt < G.MAX_LOSS) {
    S.over = true;
    const youWon = S.stacks.you > S.stacks.walt;
    $('msg').textContent += youWon ? ' Match over: you win!' : ' Match over: Walt wins.';
    S.log.push(`Match over after ${S.handNo} hands: you ${S.stacks.you}, Walt ${S.stacks.walt}.`);
  }
  render(pub.folded < 0, winners);
  setControls();
}

function newHand() {
  if (S.over) return;
  S.handNo++;
  S.human = S.handNo % 2 === 1 ? 0 : 1; // you have the button on odd hands
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 0; i < 9; i++) { const j = i + S.rng.int(52 - i); const x = deck[i]; deck[i] = deck[j]; deck[j] = x; }
  S.cards = Int8Array.from(deck.slice(0, 9));
  S.pub = G.initial();
  S.inHand = true;
  const h = human();
  S.log.push(`— Hand ${S.handNo}: ${h === 0 ? 'you are' : 'Walt is'} on the button. You hold ${name(S.cards[2 * h])} ${name(S.cards[2 * h + 1])}.`);
  render(); loop();
}

function newMatch() {
  S.stacks = { you: START, walt: START }; S.handNo = 0; S.over = false; S.inHand = false; S.cards = null; S.pub = null; S.log = [];
  $('msg').textContent = 'Press Deal to start.';
  render(); setControls();
}

for (const [id, a] of [['bFold', G.FOLD], ['bCall', G.CALL], ['bRaise', G.RAISE]]) {
  $(id).addEventListener('click', () => {
    if (!S.inHand || S.busy || S.pub.actor !== human() || !G.legal(S.pub).includes(a)) return;
    applyAction(a); render(); loop();
  });
}
$('bNext').addEventListener('click', newHand);
$('bNew').addEventListener('click', () => { if (!S.busy) newMatch(); });
newMatch();
