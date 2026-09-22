/**
 * Bottom sheets and overlays: bidding, trump declaration, hand-over, game-over.
 * Everything renders purely from GameState; taps dispatch engine actions.
 */

import { useState } from 'preact/hooks';
import type { Bid, Declaration, GameState } from '../engine';
import { highBid, isForcedBidTurn, legalBids, legalDeclarations } from '../engine';
import type { AppEvent } from './store';
import {
  HUMAN_SEAT, PIP_SUIT_NAMES, SEAT_NAMES,
  bidLabel, gameOverCopy, handOverCopy,
} from './store';
import { Tally } from './Tally';
import { BiddingHint } from './BiddingHint';
import './sheets.css';

interface SheetProps {
  g: GameState;
  dispatch: (e: AppEvent) => void;
}

interface AuctionSheetProps extends SheetProps { comfort?: boolean; sessionId: string; onQuestion: (id: string) => void }

interface EndSheetProps extends SheetProps {
  /** Swap to the hand-review card (trick-by-trick history). */
  onReview?: (() => void) | undefined;
  /** Viewing a shared hand (view-only) — no next hand to shake. */
  scenario?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

export function BidSheet({ g, dispatch, sessionId, onQuestion, comfort = false }: AuctionSheetProps) {
  const bids = legalBids(g);
  const currentBid = highBid(g.bids);
  const canPass = bids.some((b) => b.kind === 'pass');
  const pointValues = bids
    .filter((b): b is Bid & { kind: 'points' } => b.kind === 'points')
    .map((b) => b.value);
  const minPt = pointValues.length > 0 ? Math.min(...pointValues) : null;
  const maxPt = pointValues.length > 0 ? Math.max(...pointValues) : null;

  const [ptRaw, setPt] = useState(minPt ?? 30);
  const pt = minPt !== null && maxPt !== null ? Math.min(maxPt, Math.max(minPt, ptRaw)) : null;

  const plainMarks = bids.filter(
    (b): b is Bid & { kind: 'marks' } => b.kind === 'marks' && b.special === undefined,
  );
  const specials = bids.filter(
    (b): b is Bid & { kind: 'marks' } => b.kind === 'marks' && b.special !== undefined,
  );

  const [selected, setSelected] = useState<Bid | null>(null);
  const commit = (bid: Bid) => dispatch({ type: 'human', action: { type: 'bid', bid }, expectedGame: g });
  const place = (bid: Bid) => comfort ? setSelected(bid) : commit(bid);
  const isSelected = (bid: Bid) => comfort ? JSON.stringify(selected) === JSON.stringify(bid) : undefined;
  const changePoint = (value: number) => { setPt(value); if (comfort) setSelected({ kind: 'points', value }); };

  return (
    <div class="sheet bid-sheet" role="dialog" aria-label="Your bid">
      <h2 class="sheet-title">Your bid</h2>
      <p class="hint">{isForcedBidTurn(g) ? 'Everyone passed. You must bid at least 30.' : !canPass ? 'Choose your bid.' : currentBid ? `The bid is ${bidLabel(currentBid.bid)}. Raise it or pass.` : 'Bidding starts at 30. Bid or pass.'}</p>
      <BiddingHint g={g} sessionId={sessionId} onQuestion={onQuestion} />
      {pt !== null && minPt !== null && maxPt !== null && (
        <div class="bid-stepper">
          <button
            type="button"
            class="step-btn"
            aria-label="Lower bid"
            disabled={pt <= minPt}
            onClick={() => changePoint(pt - 1)}
          >
            &minus;
          </button>
          <button
            type="button"
            class="bid-go"
            aria-pressed={pt !== null ? isSelected({ kind: 'points', value: pt }) : undefined}
            onClick={() => place({ kind: 'points', value: pt })}
          >
            {comfort ? 'Choose' : 'Bid'} {pt}
          </button>
          <button
            type="button"
            class="step-btn"
            aria-label="Raise bid"
            disabled={pt >= maxPt}
            onClick={() => changePoint(pt + 1)}
          >
            +
          </button>
        </div>
      )}
      {plainMarks.length > 0 && (
        <div class="bid-row">
          {plainMarks.map((b) => (
            <button
              key={`m${b.value}`}
              type="button"
              class="bid-chip"
              aria-pressed={isSelected(b)}
              onClick={() => place(b)}
            >
              {b.value === 1 ? '1 mark (42)' : `${b.value} marks`}
            </button>
          ))}
        </div>
      )}
      {specials.map((b) => (
        <div class="bid-special" key={`${b.special}${b.value}`}>
          <button type="button" class="bid-chip special" aria-pressed={isSelected(b)} onClick={() => place(b)}>
            {bidLabel(b)}
          </button>
          <p class="hint">{specialHint(b)}</p>
        </div>
      ))}
      {canPass && (
        <button
          type="button"
          class="bid-pass"
          aria-pressed={isSelected({ kind: 'pass' })}
          onClick={() => place({ kind: 'pass' })}
        >
          Pass
        </button>
      )}
      {comfort && <div class="comfort-confirm">
        <p role="status">{selected ? `Selected: ${bidLabel(selected)}. You can still change it.` : 'Choose a bid or pass, then confirm.'}</p>
        <button type="button" class="big-btn" disabled={!selected} onClick={() => { if (selected) commit(selected); }}>
          {selected ? selected.kind === 'pass' ? 'Confirm pass' : `Confirm bid ${bidLabel(selected)}` : 'Confirm your bid'}
        </button>
      </div>}
    </div>
  );
}

function specialHint(b: Bid & { kind: 'marks' }): string {
  switch (b.special) {
    case 'plunge':
      return "4+ doubles — Gran calls trump and y'all take all 7 tricks.";
    case 'splash':
      return '3+ doubles — Gran calls trump; all 7 tricks or bust.';
    case 'nello':
      return 'Lose every trick; Gran sits this one out.';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Declaring trump
// ---------------------------------------------------------------------------

export function DeclareSheet({ g, dispatch, sessionId, onQuestion, comfort = false }: AuctionSheetProps) {
  const decls = legalDeclarations(g);
  const forPartner =
    g.contract !== null &&
    (g.contract.kind === 'plunge' || g.contract.kind === 'splash') &&
    g.declarer !== null &&
    g.declarer !== HUMAN_SEAT;
  const title = forPartner
    ? `${SEAT_NAMES[g.declarer ?? 0]} ${g.contract?.kind === 'plunge' ? 'plunged' : 'splashed'} — you call trump`
    : 'You won the bid. Call trump.';
  const [selected, setSelected] = useState<Declaration | null>(null);
  const commit = (decl: Declaration) => dispatch({ type: 'human', action: { type: 'declare', decl }, expectedGame: g });
  const declare = (decl: Declaration) => comfort ? setSelected(decl) : commit(decl);
  return (
    <div class="sheet declare-sheet" role="dialog" aria-label="Declare trump">
      <h2 class="sheet-title">{title}</h2>
      {forPartner && <p class="hint">Pick from your own hand — no hints across the table.</p>}
      <BiddingHint g={g} sessionId={sessionId} onQuestion={onQuestion} />
      <div class="decl-grid">
        {decls.map((d) => (
          <button
            key={JSON.stringify(d)}
            type="button"
            class={`decl-btn${d.type === 'nello' || d.type === 'sevens' ? ' special' : ''}`}
            aria-pressed={comfort ? JSON.stringify(selected) === JSON.stringify(d) : undefined}
            onClick={() => declare(d)}
          >
            {declTitle(d)}
          </button>
        ))}
      </div>
      {comfort && <div class="comfort-confirm">
        <p role="status">{selected ? `Selected: ${declTitle(selected)}. You can still change it.` : 'Choose trump, then confirm.'}</p>
        <button type="button" class="big-btn" disabled={!selected} onClick={() => { if (selected) commit(selected); }}>
          {selected ? `Confirm ${declTitle(selected).toLowerCase()}` : 'Confirm trump'}
        </button>
      </div>}
    </div>
  );
}

function declTitle(d: Declaration): string {
  switch (d.type) {
    case 'pip': {
      const n = PIP_SUIT_NAMES[d.pip] ?? String(d.pip);
      return n.charAt(0).toUpperCase() + n.slice(1);
    }
    case 'doubles': return 'Doubles';
    case 'no-trump': return 'No trump';
    case 'nello': return 'Nel-O';
    case 'sevens': return 'Sevens';
  }
}

// ---------------------------------------------------------------------------
// Hand over / game over
// ---------------------------------------------------------------------------

export function HandOverSheet({ g, dispatch, onReview, scenario }: EndSheetProps) {
  const copy = handOverCopy(g);
  return (
    <div class="overlay">
      <div class="card" role="dialog" aria-label="Hand over">
        <p class="eyebrow">Hand {g.handNumber}</p>
        <h2 class="card-title">{copy.title}</h2>
        <p class="card-detail">{copy.detail}</p>
        <div class="card-tallies">
          <Tally marks={g.marks[0] ?? 0} label="Us" />
          <Tally marks={g.marks[1] ?? 0} label="Them" />
        </div>
        {scenario ? (
          <button type="button" class="big-btn" onClick={() => dispatch({ type: 'go', screen: 'home' })}>
            Back home
          </button>
        ) : (
          <button
            type="button"
            class="big-btn"
            onClick={() => dispatch({ type: 'human', action: { type: 'next-hand' }, expectedGame: g })}
          >
            Shake the next hand
          </button>
        )}
        {onReview && (
          <button type="button" class="text-btn" onClick={onReview}>
            See how it went
          </button>
        )}
      </div>
    </div>
  );
}

export function GameOverSheet({ g, dispatch, onReview }: EndSheetProps) {
  const copy = gameOverCopy(g);
  const won = g.winner === 0;
  return (
    <div class="overlay">
      <div class={`card ${won ? 'card-win' : 'card-loss'}`} role="dialog" aria-label="Game over">
        <p class="eyebrow">{won ? 'A good game' : 'Until the next hand'}</p>
        <h2 class="card-title">{copy.title}</h2>
        <p class="card-detail">{copy.detail}</p>
        <div class="card-tallies">
          <Tally marks={g.marks[0] ?? 0} label="Us" />
          <Tally marks={g.marks[1] ?? 0} label="Them" />
        </div>
        <button
          type="button"
          class="big-btn"
          onClick={() => dispatch({ type: 'new-game', seed: Date.now().toString(36) })}
        >
          Play again
        </button>
        {onReview && (
          <button type="button" class="text-btn" onClick={onReview}>
            See how it went
          </button>
        )}
        <button type="button" class="text-btn" onClick={() => dispatch({ type: 'go', screen: 'home' })}>
          Back home
        </button>
      </div>
    </div>
  );
}
