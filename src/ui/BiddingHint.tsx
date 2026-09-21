import { useEffect, useRef, useState } from 'preact/hooks';
import { highBid, type GameState } from '../engine';
import { BID_BOOK, bestPanel, qualifies, type PlayedPanel } from '../ai/bid-book';
import { getBiddingHint, type BiddingHint as Advice } from '../ai/bidding-hint';
import { bidLabel, PIP_SUIT_NAMES, SEAT_NAMES } from './store';
import './hint.css';

type BookAdvice = Extract<Advice, { kind: 'book' }>;
const cutoff = 100 * BID_BOOK.threshold[0] / BID_BOOK.threshold[1];
const suitName = (decl: number): string => decl === 9 ? 'No trump' : decl === 7 ? 'Doubles'
  : (PIP_SUIT_NAMES[decl] ?? String(decl)).replace(/^./, c => c.toUpperCase());
const scoreRate = (panel: PlayedPanel, target: number): string => `${(100 * panel.tails[target - 30]! / panel.games).toFixed(1)}%`;

function recommendation(h: BookAdvice): string {
  if (h.action.type === 'declare') return `Walt suggests ${suitName(h.panel.decl).toLowerCase()}`;
  if (h.action.type === 'bid' && h.action.bid.kind !== 'pass') return `Walt would bid ${bidLabel(h.action.bid)}`;
  return 'Walt would pass';
}

function reason(h: BookAdvice, g: GameState): string {
  const trump = suitName(h.panel.decl).toLowerCase();
  if (h.reason === 'partner') {
    const high = highBid(g.bids)!;
    return `${SEAT_NAMES[high.seat]} already holds the bid at ${bidLabel(high.bid)}. Walt would let your partner keep it. This pass is about teamwork, not a weak-hand verdict.`;
  }
  if (h.reason === 'forced') return `Everyone passed, so you must bid at least 30. Walt would choose ${trump}. `
    + (qualifies(h.panel, h.target) ? `This is the highest bid meeting its ${cutoff}% cutoff in the recorded games.`
      : `Even its best option falls below the usual ${cutoff}% cutoff; this is the best available choice for a forced bid.`);
  if (h.reason === 'pass') return `No declaration reached the minimum legal bid of ${bidLabel(h.minimum!)} in at least ${cutoff}% of its recorded games.`
    + (h.ceiling !== null ? ` At a lower price, ${h.ceiling} points would meet that cutoff, but that bid is no longer available.` : ' Walt would sit this auction out.');
  if (h.reason === 'declare') return `For your ${h.target}-point target, this declaration has the highest recorded rate.`
    + (qualifies(h.panel, h.target) ? '' : ` Even the best option is below Walt’s usual ${cutoff}% bidding cutoff.`);
  return `With ${trump}, this is the highest legal bid meeting Walt’s ${cutoff}% cutoff in the recorded games.`;
}

function RecordedScore({ panel, target }: { panel: PlayedPanel; target: number }) {
  return <>
    <p class="bid-hint-evidence">With <strong>{suitName(panel.decl).toLowerCase()}</strong>, Walt’s team reached at least <strong>{target} points</strong> in{' '}
      <strong>{panel.tails[target - 30]} of {panel.games}</strong> recorded games ({scoreRate(panel, target)}).</p>
    {panel.uncertain.includes(target) && <p class="setting-hint">This result is near the {cutoff}% cutoff. More games could change the suggestion.</p>}
  </>;
}

function BookDetails({ hint, g }: { hint: BookAdvice; g: GameState }) {
  const [target, setTarget] = useState(hint.target);
  const selected = bestPanel(hint.panels, target);
  const rows = [...hint.panels].sort((a, b) => b.tails[target - 30]! / b.games - a.tails[target - 30]! / a.games);
  const best = (p: PlayedPanel) => p.tails[target - 30]! * selected.games === selected.tails[target - 30]! * p.games;
  const next = hint.reason === 'bid' && hint.target < 42 ? bestPanel(hint.panels, hint.target + 1) : null;
  return <>
    <h3 class="bid-hint-suggestion">{recommendation(hint)}</h3>
    <p>{reason(hint, g)}</p>
    {hint.reason === 'partner' && <p class="setting-hint">You can still explore your own hand’s recorded results below.</p>}
    <RecordedScore panel={hint.panel} target={hint.target} />
    {next && <p class="setting-hint">At {hint.target + 1} points, the best recorded rate drops to {scoreRate(next, hint.target + 1)} ({next.tails[hint.target + 1 - 30]} of {next.games} games).</p>}
    {hint.target === 42 && <p class="setting-hint">42 points means all seven tricks. These results don’t measure whether risking extra marks is worthwhile.</p>}
    <p class="setting-hint">These games aimed for 30; higher totals are a guide to bidding, not a measured chance of making a higher contract.</p>
    <details class="disclosure bid-hint-comparison">
      <summary>Compare trumps</summary>
      <label class="bid-hint-target">Explore a target
        <select value={target} onChange={e => setTarget(Number(e.currentTarget.value))}>
          {Array.from({ length: 13 }, (_, i) => i + 30).map(n => <option key={n} value={n}>{n} points{n === 42 ? ' · all tricks' : ''}</option>)}
        </select>
      </label>
      <p class="setting-hint">Exploring scores doesn’t place a bid. Some targets may be below the current bid.</p>
      <table class="bid-hint-table">
        <caption>Recorded games reaching at least {target} points</caption>
        <thead><tr><th scope="col">Trump</th><th scope="col">Games</th><th scope="col">Rate</th></tr></thead>
        <tbody>{rows.map(p => <tr key={p.decl} class={best(p) ? 'bid-hint-best' : ''}>
          <th scope="row">{suitName(p.decl)}{best(p) && <span class="bid-hint-tag">Highest{rows.filter(best).length > 1 ? ' · tied' : ''}</span>}</th>
          <td>{p.tails[target - 30]} / {p.games}{p.uncertain.includes(target) && <span class="bid-hint-tag">Unsettled</span>}</td>
          <td>{scoreRate(p, target)}</td>
        </tr>)}</tbody>
      </table>
      <p class="setting-hint">A higher recorded rate isn’t a guarantee. Sample counts vary; “unsettled” means more samples may change which side of {cutoff}% a score falls on.</p>
      <p class="setting-hint">These are completed Walt games with your seven dominoes and different partner and opponent hands. No one’s actual hidden hand is used. The results don’t infer hidden hands from this auction’s bids.</p>
    </details>
  </>;
}

/** A read-only modal: no dispatch, evaluation worker, or network request. */
export function BiddingHint({ g }: { g: GameState }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  const hint = open ? getBiddingHint(g) : null;
  return <>
    <button type="button" class="hint-button bid-hint-button" ref={button} onClick={() => setOpen(true)}>
      {g.phase === 'declaring' ? 'Help me choose trump' : 'Help me bid'}
    </button>
    <dialog ref={dialog} class="hint-dialog" aria-labelledby="bid-hint-title" onCancel={e => { e.preventDefault(); close(); }}>
      <header class="hint-header"><h2 id="bid-hint-title">{g.phase === 'declaring' ? 'Choosing trump' : 'A bidding hint'}</h2>
        <button type="button" class="hint-close" aria-label="Close hint" onClick={close}>×</button></header>
      {hint?.kind === 'book' && <BookDetails hint={hint} g={g} />}
      {hint?.kind === 'unavailable' && <p>{hint.reason === 'missing-hand'
        ? 'Walt doesn’t have recorded games for this hand. Bidding hints are available for hands in the current deal book; you can still choose your own bid and trump.'
        : 'The recorded games cover ordinary 42 with you as the bidder. They don’t cover this contract or rule set.'}</p>}
      <div class="hint-actions"><button type="button" class="big-btn" onClick={close}>
        {g.phase === 'declaring' ? 'Back to choosing trump' : 'Back to my bid'}
      </button></div>
    </dialog>
  </>;
}
