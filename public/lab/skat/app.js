// Skat vs Walt — page controller. Engine: skat.js; AI: walt.js inside worker.js.
import * as S from './skat.js';

const CFGS = {
  // the configuration measured in lab/skat/REPORT.md
  std: { level: 1, n: 32, n0: 6, horizon: [3, 6], endgame: 15, rollout: 'rule' },
  fast: { level: 1, n: 16, n0: 4, horizon: [3, 5], endgame: 12, rollout: 'rule' },
};

const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map();
worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); } };
worker.onerror = (e) => { $('msg').textContent = 'Worker error: ' + (e.message || e); };
const askWalt = (seat, priv, pub, seed) => new Promise((res) => {
  const id = ++reqId; pending.set(id, res);
  worker.postMessage({ id, seat, priv, pub, cfg: CFGS[$('strength').value] || CFGS.std, seed });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let st = null; // current game
let gameToken = 0;

function seatName(s) {
  if (!st) return '';
  if (s === st.human) return 'You';
  return s === (st.human + 1) % 3 ? 'Walt (left)' : 'Walt (right)';
}
function sortKey(c, g) {
  const e = S.ESUIT[g][c];
  return (e === S.TRUMP ? 0 : 1 + e) * 100 - S.STR[g][c];
}
function cardEl(c, g, cls = '') {
  const d = document.createElement('div');
  const s = S.suitOf(c);
  d.className = 'card ' + cls + (s === 2 || s === 3 ? ' red' : '') + (g !== null && S.ESUIT[g][c] === S.TRUMP ? ' trump' : '');
  d.innerHTML = `<span>${S.RANKS[S.rankOf(c)]}</span><span class="s">${S.SUITS[s]}</span>`;
  d.title = S.cardName(c);
  return d;
}

function newGame(role) {
  gameToken++;
  const seed = (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
  const rng = S.makeRng(seed);
  const { hands, skat } = S.dealCards(rng);
  const decl = S.chooseDeclarer(hands);
  const human = role === 'decl' ? decl : (decl + 1 + rng.int(2)) % 3;
  st = { seed, rng, preHands: hands, skat0: skat, decl, human, g: null, deal: null, pub: null,
    phase: 'pickup', shown: [], lastTrick: null, log: [], lastMs: null, pick: null };
  if (human === decl) {
    const sug = S.chooseGameAndDiscard(hands[decl] | skat);
    st.pick = { g: sug.g, discard: sug.discard, h12: hands[decl] | skat };
    st.g = sug.g;
    showPickup();
  } else {
    const { g, discard } = S.chooseGameAndDiscard(hands[decl] | skat);
    startPlay(g, discard);
  }
  render();
}

function showPickup() {
  $('pickup').classList.remove('hidden');
  const box = $('gameBtns'); box.innerHTML = '';
  for (let g = 0; g <= 4; g++) {
    const b = document.createElement('button');
    b.className = 'secondary' + (st.pick.g === g ? ' sel' : '');
    b.textContent = g < 4 ? `${S.SUITS[g]} ${S.GAME_NAMES[g]}` : 'Grand';
    b.onclick = () => { st.pick.g = g; st.g = g; showPickup(); render(); };
    box.appendChild(b);
  }
  const n = S.popcount(st.pick.discard);
  $('pickupHint').textContent = `Tap cards to choose the discard (${n}/2 chosen, worth ${S.pointsOf(st.pick.discard)} points — they count for you at the end). Pre-selected: the bot's suggestion.`;
  $('startPlay').disabled = n !== 2;
}
$('startPlay').onclick = () => {
  if (!st || st.phase !== 'pickup' || S.popcount(st.pick.discard) !== 2) return;
  $('pickup').classList.add('hidden');
  startPlay(st.pick.g, st.pick.discard);
};

function startPlay(g, discard) {
  const h = st.preHands.slice();
  h[st.decl] = (st.preHands[st.decl] | st.skat0) & ~discard;
  st.g = g;
  st.deal = { h, skat: discard, sp: S.pointsOf(discard) };
  st.pub = S.initialPublic(g, st.decl);
  st.phase = 'play';
  st.shown = [];
  render();
  loop(gameToken);
}

async function loop(token) {
  while (st && token === gameToken && st.phase === 'play') {
    const pub = st.pub;
    if (pub.nPlayed === 30) break;
    const seat = pub.turn;
    if (seat === st.human) { render(); return; } // wait for a click
    render();
    const priv = S.privateOf(st.deal, seat, pub);
    const t0 = performance.now();
    const r = await askWalt(seat, priv, pub, st.rng.next() | 0);
    const wait = 450 - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
    if (token !== gameToken) return;
    st.lastMs = r.ms;
    await applyMove(r.card, token);
  }
  if (st && token === gameToken && st.pub.nPlayed === 30) finish();
}

async function applyMove(c, token) {
  const pub = st.pub;
  const L = S.legalMask(st.deal.h[pub.turn] & ~pub.played, pub);
  if (!((L >> c) & 1)) throw new Error('illegal move ' + c);
  if (pub.trick.length === 0) st.shown = [];
  st.shown.push({ seat: pub.turn, c });
  const next = S.play(pub, c);
  st.pub = next;
  if (next.trick.length === 0) { // trick complete
    const pts = st.shown.reduce((s, x) => s + S.PTS[x.c], 0);
    st.lastTrick = { cards: st.shown.slice(), winner: next.leader, pts };
    st.log.push(st.lastTrick);
    render();
    await sleep(1000);
    if (token !== gameToken) return;
    st.shown = [];
  }
  render();
}

function onCardClick(c) {
  if (!st) return;
  if (st.phase === 'pickup') {
    const bit = 1 << c;
    if (st.pick.discard & bit) st.pick.discard &= ~bit;
    else if (S.popcount(st.pick.discard) < 2) st.pick.discard |= bit;
    showPickup(); render(); return;
  }
  if (st.phase !== 'play' || st.pub.turn !== st.human || st.busy) return;
  const L = S.legalMask(st.deal.h[st.human] & ~st.pub.played, st.pub);
  if (!((L >> c) & 1)) return;
  st.busy = true;
  const token = gameToken;
  applyMove(c, token).then(() => { if (token === gameToken) { st.busy = false; loop(token); } });
}

function finish() {
  st.phase = 'over';
  render();
}

function render() {
  const info = $('info');
  if (!st) { info.innerHTML = '<div>Start a new game.</div>'; return; }
  const g = st.g;
  const pub = st.pub;
  const gtxt = g === null ? '—' : g < 4 ? `${S.SUITS[g]} ${S.GAME_NAMES[g]} (jacks + ${S.SUITS[g]} are trump)` : 'Grand (only jacks are trump)';
  const tricksDecl = st.log.filter((t) => t.winner === st.decl).length;
  const tricksDef = st.log.length - tricksDecl;
  const declPts = pub ? pub.declPts : 0, defPts = pub ? pub.defPts : 0;
  const humanDecl = st.human === st.decl;
  const skatTxt = st.phase === 'over' || humanDecl ? `+ skat ${st.deal ? st.deal.sp : S.pointsOf(st.pick ? st.pick.discard : 0)}` : '+ skat ?';
  info.innerHTML = `
    <div>Game: <b>${gtxt}</b></div>
    <div>Declarer: <b>${seatName(st.decl)}</b>${humanDecl ? '' : ' — you defend with Walt'}</div>
    <div>Declarer points: <b>${declPts}</b> ${skatTxt}</div>
    <div>Defender points: <b>${defPts}</b></div>
    <div>Tricks: declarer ${tricksDecl} · defenders ${tricksDef}</div>
    <div>Walt's last move: ${st.lastMs === null ? '—' : st.lastMs + ' ms'}</div>`;

  // seats
  const L = (st.human + 1) % 3, R = (st.human + 2) % 3;
  const seatHtml = (s) => {
    const left = pub ? S.handSize(pub, s) : 10;
    return `<div class="nm">${seatName(s)}${s === st.decl ? ' ★' : ''}</div><div>${left} cards</div>`;
  };
  for (const [id, s] of [['seatL', L], ['seatR', R], ['seatM', st.human]]) {
    const el = $(id);
    el.innerHTML = id === 'seatM' ? `<span class="nm">You${st.human === st.decl ? ' ★ declarer' : ' (defender)'}</span>` : seatHtml(s);
    el.classList.toggle('turn', !!pub && st.phase === 'play' && pub.turn === s);
  }
  // trick in the middle
  const tr = $('trick'); tr.innerHTML = '';
  for (const { seat, c } of st.shown) {
    const pos = seat === st.human ? 'p-me' : seat === L ? 'p-left' : 'p-right';
    tr.appendChild(cardEl(c, g, pos));
  }
  // hand
  const hand = $('hand'); hand.innerHTML = '';
  let cards, legal = 0;
  if (st.phase === 'pickup') {
    cards = S.bits(st.pick.h12);
  } else {
    cards = S.bits(st.deal.h[st.human] & ~pub.played);
    if (st.phase === 'play' && pub.turn === st.human) legal = S.legalMask(st.deal.h[st.human] & ~pub.played, pub);
  }
  cards.sort((a, b) => sortKey(a, g === null ? 4 : g) - sortKey(b, g === null ? 4 : g));
  for (const c of cards) {
    let cls = '';
    if (st.phase === 'pickup') cls = (st.pick.discard >> c) & 1 ? 'picked legal' : 'legal';
    else if (legal) cls = (legal >> c) & 1 ? 'legal' : 'dim';
    const el = cardEl(c, g, cls);
    el.onclick = () => onCardClick(c);
    hand.appendChild(el);
  }
  // message
  const msg = $('msg'); msg.className = 'msg';
  if (st.phase === 'pickup') msg.textContent = 'Choose your game and 2 cards to discard.';
  else if (st.phase === 'play') msg.textContent = pub.turn === st.human ? 'Your turn — tap a highlighted card.' : `${seatName(pub.turn)} is thinking…`;
  else {
    const total = pub.declPts + st.deal.sp;
    const made = total >= 61;
    const humanWon = made === humanDecl;
    msg.className = 'msg ' + (humanWon ? 'good' : 'bad');
    msg.innerHTML = `Declarer ${made ? 'made it' : 'failed'}: ${total} points (tricks ${pub.declPts} + skat ${st.deal.sp}) vs ${120 - total}. ${humanWon ? 'You win!' : 'You lose.'} `;
    const sk = document.createElement('span'); sk.className = 'row'; sk.style.justifyContent = 'center';
    sk.append('Skat: ');
    for (const c of S.bits(st.deal.skat)) sk.appendChild(cardEl(c, g, 'small'));
    msg.appendChild(sk);
  }
  // last trick & log
  const lt = $('lastTrick'); lt.innerHTML = '';
  if (st.lastTrick) {
    for (const { seat, c } of st.lastTrick.cards) {
      const w = document.createElement('span'); w.className = 'row'; w.style.marginRight = '8px';
      w.append(cardEl(c, g, 'small'), ' ' + seatName(seat));
      lt.appendChild(w);
    }
    lt.append(` → ${seatName(st.lastTrick.winner)} (+${st.lastTrick.pts})`);
  } else lt.innerHTML = '<span class="sub">—</span>';
  $('log').innerHTML = st.log.map((t, i) => `${i + 1}. ${t.cards.map((x) => S.cardName(x.c)).join(' ')} → ${seatName(t.winner)} +${t.pts}`).join('<br>') || '—';
}

$('newDecl').onclick = () => newGame('decl');
$('newDef').onclick = () => newGame('def');
render();
