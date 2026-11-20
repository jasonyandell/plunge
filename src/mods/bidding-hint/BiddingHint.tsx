import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState, Seat } from '../../engine';
import { BookDetails, ForecastDetails, waltAuctionAdvice, zebAuctionAdvice, type ZebAuctionAdvice } from '../../kernel/mod-api';

/** On-demand advice never places a bid; optional feedback preserves the evidence. */
export function BiddingHint({ g, sessionId, questionGameId = sessionId, onQuestion, player = 'walt', bookSeat = 0 }: { player?: 'walt' | 'zeb'; bookSeat?: Seat; g: GameState; sessionId: string; questionGameId?: string; onQuestion: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  const [zeb, setZeb] = useState<ZebAuctionAdvice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if(!open || player!=='zeb')return;
    const controller=new AbortController(); let live=true;
    setZeb(null); setError(null);
    void zebAuctionAdvice(g,sessionId,controller.signal).then(value=>{if(live)setZeb(value);},error=>{if(live)setError(String(error));});
    return ()=>{live=false;controller.abort();};
  },[open,player,g,sessionId,retry]);
  const hint = open && player !== 'zeb' ? waltAuctionAdvice(g, bookSeat) : null;
  return <>
    <button type="button" class="hint-button bid-hint-button" ref={button} onClick={() => setOpen(true)}>
      {g.phase === 'declaring' ? 'Help me choose trump' : 'Help me bid'}
    </button>
    <dialog ref={dialog} class="hint-dialog" aria-labelledby="bid-hint-title" onCancel={e => { e.preventDefault(); close(); }}>
      <header class="hint-header"><h2 id="bid-hint-title">{g.phase === 'declaring' ? 'Choosing trump' : 'A bidding hint'}</h2>
        <button type="button" class="hint-close" aria-label="Close hint" onClick={close}>×</button></header>
      {open && player==='zeb' && <section aria-live="polite">
        {error ? <><p>{error}</p><button type="button" onClick={()=>setRetry(retry+1)}>Try hint again</button></> : !zeb ? <p>Zeb is considering your hand…</p> : <ForecastDetails g={g} hint={zeb}
          capture={{ sessionId, questionGameId, onSaved: id => { close(); onQuestion(id); } }} />}
      </section>}
      {hint?.kind === 'book' && <BookDetails hint={hint} g={g} capture={{ sessionId, questionGameId, onSaved: id => { close(); onQuestion(id); } }} />}
      {hint?.kind === 'unavailable' && <p>{hint.reason === 'missing-hand'
        ? 'Walt doesn’t have recorded games for this hand. Bidding hints are available for hands in the current deal book; you can still choose your own bid and trump.'
        : 'The recorded games cover ordinary 42 with you as the bidder. They don’t cover this contract or rule set.'}</p>}
      <div class="hint-actions"><button type="button" class="big-btn" onClick={close}>
        {g.phase === 'declaring' ? 'Back to choosing trump' : 'Back to my bid'}
      </button></div>
    </dialog>
  </>;
}
