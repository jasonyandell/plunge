// Bridge vs Walt — the page. EXPLORATORY tier.
// You always sit South: either declarer (you also play dummy North) or a defender
// (Walt declares from East with dummy West; your partner North is Walt).
import {
  Rng, Pub, randomDeal, contractFor, rotateDeal, legalCards, visibleSeats, trickWinnerPos,
  SUIT, RANK, RANK_CHARS, SUIT_CHARS, SEAT_NAMES, STRAIN_NAMES, cardName, NORTH, EAST, SOUTH, WEST,
} from './engine.js';
import { agentOf } from './walt.js';

const STRENGTH = {
  quick: { n: 16, n0: 4, horizon: 8 },
  standard: { n: 32, n0: 8, horizon: 8 },
  deep: { n: 64, n0: 8, horizon: 8 },
};
const DISPLAY_SUITS = [3, 2, 0, 1]; // ♠ ♥ ♣ ♦ (alternating colours)
const HUMAN = SOUTH;
const $ = (id) => document.getElementById(id);
const isRed = (u) => u === 1 || u === 2;

let G = null;
let reqId = 0;
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.onmessage = (e) => {
  const m = e.data;
  if (!G || m.id !== G.pending) return; // stale answer from an abandoned deal
  G.pending = 0;
  if (m.error) { setStatus('Walt failed: ' + m.error, 'lose'); console.error(m.error); return; }
  const seat = G.pub.toMove();
  const made = m.values.find((v) => v[0] === m.card);
  G.walt = { seat, card: m.card, ms: m.ms, made: made ? made[1] : null, of: made ? made[2] : null,
    declSide: G.pub.isDeclSide(seat) };
  G.times.push(m.ms);
  play(m.card);
};
worker.onerror = (e) => { setStatus('Worker error: ' + e.message, 'lose'); };

function newGame(seed, mode) {
  const rng = new Rng(seed);
  const d0 = randomDeal(rng);
  const ct = contractFor(d0);
  const want = mode === 'declare' ? SOUTH : EAST;
  const deal = rotateDeal(d0, (want - ct.decl) & 3);
  const c = { decl: want, strain: ct.strain, level: ct.level };
  G = { seed, mode, deal, ct: c, pub: new Pub(c.decl, c.strain, c.level), hold: null, last: null,
    walt: null, times: [], pending: 0, announced: false, strength: $('strength').value };
  const u = new URL(location.href);
  u.searchParams.set('deal', String(seed)); u.searchParams.set('seat', mode);
  history.replaceState(null, '', u);
  $('dealNo').textContent = `Deal #${seed} · link reproduces this deal`;
  $('lastTrick').textContent = '—'; $('waltInfo').textContent = '—';
  render();
  step();
}

function hand(seat) {
  const h = new Uint16Array(4);
  for (let u = 0; u < 4; u++) h[u] = G.deal[seat * 4 + u] & ~G.pub.played[u];
  return h;
}

function humanToMove() {
  const p = G.pub;
  return !G.hold && !G.pending && p.n < 52 && agentOf(p, p.toMove()) === HUMAN;
}

function step() {
  const p = G.pub;
  render();
  if (G.hold) return;
  announce();
  if (p.n === 52) { finish(); return; }
  const seat = p.toMove(), agent = agentOf(p, seat);
  if (agent === HUMAN) {
    const who = seat === HUMAN ? 'your hand' : 'dummy (North)';
    if (!G.announced) setStatus(`Your turn: play from ${who}.`);
    else setStatus(`Your turn: play from ${who}. (Playing on to 13 tricks.)`, G.announcedClass);
    return;
  }
  // Walt's move: send only what this agent may see.
  const vis = visibleSeats(agent, p);
  const known = new Array(16).fill(0);
  for (let s = 0; s < 4; s++) if (vis & (1 << s)) for (let u = 0; u < 4; u++) known[s * 4 + u] = G.deal[s * 4 + u];
  const id = ++reqId;
  G.pending = id;
  if (!G.announced) setStatus(`Walt is thinking for ${SEAT_NAMES[seat]}…`);
  worker.postMessage({ id, ct: G.ct, plays: Array.from(p.plays.slice(0, p.n)), agent, known,
    cfg: { ...STRENGTH[G.strength], seed: (G.seed * 131 + p.n) >>> 0 } });
}

function play(c) {
  const p = G.pub;
  p.apply(c);
  if (p.tl === 0) {
    // trick complete: keep it on the table for a moment
    const cards = Array.from(p.plays.slice(p.n - 4, p.n));
    const leader = p.seatOf[p.n - 4];
    G.hold = { cards, leader, winner: p.leader };
    G.last = G.hold;
    if (!G.announced) setStatus(`${SEAT_NAMES[p.leader]} wins the trick.`);
    render();
    setTimeout(() => { G.hold = null; step(); }, 950);
    return;
  }
  step();
}

function onCardClick(c) {
  if (!humanToMove()) return;
  const p = G.pub, seat = p.toMove();
  if (!legalCards(hand(seat), p).includes(c)) return;
  play(c);
}

function announce() {
  const p = G.pub;
  if (G.announced) return;
  const o = p.outcome();
  if (o < 0) return;
  G.announced = true;
  const youDeclare = G.mode === 'declare';
  const good = (o === 1) === youDeclare;
  G.announcedClass = good ? 'win' : 'lose';
  const txt = o === 1
    ? (youDeclare ? `Made it — ${ctText()} is home.` : `${ctText()} made — Walt got there.`)
    : (youDeclare ? `Defeated — Walt's defence beat ${ctText()}.` : `Defeated! You and Walt beat ${ctText()}.`);
  setStatus(txt, G.announcedClass);
}

function finish() {
  const p = G.pub, need = p.target, got = p.declTricks;
  const res = got >= need ? `made${got > need ? ' +' + (got - need) : ''}` : `down ${need - got}`;
  setStatus(`Hand over: declarer took ${got} — ${ctText()} ${res}. New deal?`, G.announcedClass);
  render();
}

function ctText() { return `${G.ct.level}${STRAIN_NAMES[G.ct.strain]}`; }

function setStatus(t, cls = '') { const el = $('status'); el.textContent = t; el.className = 'status ' + cls; }

// ------------------------------------------------------------------ rendering
function cardEl(c, opts = {}) {
  const b = document.createElement('button');
  b.className = 'cardbtn' + (isRed(SUIT[c]) ? ' red' : '') + (opts.legal ? ' legal' : '') + (opts.win ? ' win' : '');
  b.innerHTML = `<span>${RANK_CHARS[RANK[c]].replace('T', '10')}</span><span class="s">${SUIT_CHARS[SUIT[c]]}</span>`;
  b.setAttribute('aria-label', cardName(c));
  b.dataset.card = String(c);
  if (opts.legal) b.addEventListener('click', () => onCardClick(c));
  else b.disabled = true;
  return b;
}

function faceUp(seat) {
  const p = G.pub;
  if (seat === HUMAN || p.n === 52) return true;
  return seat === p.dummy && p.n >= 1;
}

function roleOf(seat) {
  const p = G.pub;
  if (seat === p.decl) return seat === HUMAN ? 'You · declarer' : 'Walt · declarer';
  if (seat === p.dummy) return p.decl === HUMAN ? 'Dummy (yours)' : 'Dummy (Walt)';
  return seat === HUMAN ? 'You · defender' : 'Walt · defender';
}

function renderSeat(seat) {
  const p = G.pub, el = $('seat-' + seat);
  el.innerHTML = '';
  el.classList.toggle('turn', p.n < 52 && !G.hold && p.toMove() === seat);
  const lab = document.createElement('div');
  lab.className = 'label';
  lab.innerHTML = `<b>${SEAT_NAMES[seat]}</b><span class="tag">${roleOf(seat)}</span>`;
  el.appendChild(lab);
  const over = p.n === 52;
  // When the hand is over, every seat shows its original 13 cards for review.
  const h = over ? G.deal.slice(seat * 4, seat * 4 + 4) : hand(seat);
  const count = h.reduce((a, m) => a + popc(m), 0);
  const wide = (seat === NORTH || seat === SOUTH) && !over;
  if (!faceUp(seat)) {
    const d = document.createElement('div');
    d.className = 'hidden';
    d.innerHTML = `<span class="backs">${'<i></i>'.repeat(count)}</span> ${count}`;
    el.appendChild(d);
    return;
  }
  if (wide) {
    const legal = humanToMove() && p.toMove() === seat ? new Set(legalCards(h, p)) : new Set();
    const hd = document.createElement('div');
    hd.className = 'hand';
    for (const u of DISPLAY_SUITS) {
      if (!h[u]) continue;
      const g = document.createElement('div');
      g.className = 'suitgroup';
      for (let r = 12; r >= 0; r--) if (h[u] & (1 << r)) g.appendChild(cardEl(u * 13 + r, { legal: legal.has(u * 13 + r) }));
      hd.appendChild(g);
    }
    if (!count) hd.textContent = '';
    el.appendChild(hd);
  } else {
    const rows = document.createElement('div');
    rows.className = 'rows';
    for (const u of DISPLAY_SUITS) {
      const d = document.createElement('div');
      let t = '';
      for (let r = 12; r >= 0; r--) if (h[u] & (1 << r)) t += (RANK_CHARS[r] === 'T' ? '10' : RANK_CHARS[r]) + ' ';
      d.innerHTML = `<span class="${isRed(u) ? 'red' : ''}">${SUIT_CHARS[u]}</span> ${t || '—'}`;
      rows.appendChild(d);
    }
    el.appendChild(rows);
  }
}

function popc(m) { let k = 0; while (m) { m &= m - 1; k++; } return k; }

function renderTrick() {
  const p = G.pub;
  for (let s = 0; s < 4; s++) $('slot-' + s).innerHTML = '';
  let cards, leader, winner = -1;
  if (G.hold) { ({ cards, leader } = G.hold); winner = G.hold.winner; }
  else { cards = Array.from(p.tc.slice(0, p.tl)); leader = p.leader; }
  for (let i = 0; i < cards.length; i++) {
    const s = (leader + i) & 3;
    $('slot-' + s).appendChild(cardEl(cards[i], { win: s === winner }));
  }
}

function render() {
  const p = G.pub;
  $('contract').textContent = `${G.ct.level}${STRAIN_NAMES[G.ct.strain]} by ${SEAT_NAMES[p.decl]} · needs ${p.target} tricks`;
  const nsDecl = p.decl === NORTH || p.decl === SOUTH;
  const ns = nsDecl ? p.declTricks : p.defTricks, ew = nsDecl ? p.defTricks : p.declTricks;
  $('ns').textContent = `N/S ${ns}`; $('ew').textContent = `E/W ${ew}`;
  for (const s of [NORTH, EAST, SOUTH, WEST]) renderSeat(s);
  renderTrick();
  if (G.last) {
    const { cards, leader, winner } = G.last;
    $('lastTrick').innerHTML = cards.map((c, i) => {
      const s = (leader + i) & 3;
      const t = `${SEAT_NAMES[s][0]}: <span class="${isRed(SUIT[c]) ? 'red' : ''}">${cardName(c).replace('T', '10')}</span>`;
      return s === winner ? `<b>${t}</b>` : t;
    }).join(' · ') + ` → ${SEAT_NAMES[winner]}`;
  }
  if (G.walt) {
    const w = G.walt;
    const what = `${SEAT_NAMES[w.seat]} played ${cardName(w.card).replace('T', '10')}`;
    const t = (w.ms / 1000).toFixed(1);
    $('waltInfo').textContent = w.made === null
      ? `${what} (no real choice)`
      : `${what} — contract makes in ${w.made}/${w.of} of the deals Walt sampled (${t} s)`;
  }
}

// ------------------------------------------------------------------ controls
function freshSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % 1000000;
}
$('newDeal').addEventListener('click', () => newGame(freshSeed(), $('mode').value));
$('mode').addEventListener('change', () => newGame(G ? G.seed : freshSeed(), $('mode').value));
$('strength').addEventListener('change', () => { if (G) G.strength = $('strength').value; });

const q = new URLSearchParams(location.search);
const seat0 = q.get('seat') === 'defend' ? 'defend' : 'declare';
$('mode').value = seat0;
const d0 = Number(q.get('deal'));
newGame(Number.isInteger(d0) && d0 > 0 ? d0 : freshSeed(), seat0);

// Test hook (Playwright): expose read-only state.
window.__bridge = { get state() { return G; }, trickWinnerPos };
