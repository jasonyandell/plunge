import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { DominoId } from '../../engine';
import { Domino, dominoAriaLabel, store, type HandSlotProps } from '../../kernel/mod-api';
import { arranged, dealKey, loadOrder, moved, nearest, saveOrder } from './order';
import './drag-arrange.css';

const saved = store('drag-arrange');
/** Movement before a press becomes a drag; less is a tap. */
const SLOP = 8;

interface Drag { id: DominoId; from: number; target: number; dx: number; dy: number; slots: DOMRect[] }

export interface TilesProps extends Pick<HandSlotProps, 'legal' | 'humanTurn' | 'showHints'> {
  tiles: readonly DominoId[];
  drag: Drag | null;
  onTap: (id: DominoId) => void;
  onDown: (e: JSX.TargetedPointerEvent<HTMLDivElement>, id: DominoId) => void;
  onKey: (e: JSX.TargetedKeyboardEvent<HTMLDivElement>, id: DominoId) => void;
}

/** The tiles as core draws them: buttons only when playable, so a tap plays as before. */
export function Tiles({ tiles, drag, legal, humanTurn, showHints, onTap, onDown, onKey }: TilesProps) {
  return <>{tiles.map((id, i) => {
    const lifted = drag?.id === id ? drag : null;
    const from = lifted && lifted.slots[lifted.from], to = lifted && lifted.slots[i];
    const style = from && to ? { transform: `translate(${lifted.dx + from.left - to.left}px, ${lifted.dy + from.top - to.top}px)` } : undefined;
    return (
      <div key={id} data-id={id} class={`drag-arrange-tile${lifted ? ' drag-arrange-lifted' : ''}`} style={style}
        onPointerDown={e => onDown(e, id)} onKeyDown={e => onKey(e, id)}>
        <Domino id={id} orientation="h" state={humanTurn && showHints ? (legal.has(id) ? 'legal' : 'illegal') : 'idle'}
          interactive={humanTurn && !showHints} onTap={() => onTap(id)} />
      </div>
    );
  })}</>;
}

/** Display order only: never reorders the engine's hand or tells the table. */
export function DragHand({ game, seat, hand, legal, humanTurn, showHints, onPlay }: HandSlotProps) {
  const deal = dealKey(game, seat);
  const [mine, setMine] = useState(() => ({ deal, order: loadOrder(saved, deal) }));
  const order = mine.deal === deal ? mine.order : loadOrder(saved, deal);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const stop = useRef<(() => void) | null>(null);
  const dragged = useRef(false);
  const shown = arranged(hand, order);

  useEffect(() => () => stop.current?.(), [hand.join(','), deal]);

  const commit = (id: DominoId, target: number) => {
    const next = moved(order, hand, id, target);
    setMine({ deal, order: next });
    saveOrder(saved, deal, next);
    setSaid(`${dominoAriaLabel(id)} moved to ${target + 1} of ${hand.length}.`);
  };

  const onDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>, id: DominoId) => {
    if (!e.isPrimary || e.button !== 0 || stop.current || !root.current) return;
    dragged.current = false;
    const pointer = e.pointerId, x0 = e.clientX, y0 = e.clientY, from = shown.indexOf(id);
    const slots = [...root.current.querySelectorAll('.drag-arrange-tile')].map(el => el.getBoundingClientRect());
    let target = from;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!dragged.current && Math.hypot(dx, dy) < SLOP) return;
      dragged.current = true;
      ev.preventDefault();
      target = nearest(slots, ev.clientX, ev.clientY);
      setDrag({ id, from, target, dx, dy, slots });
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      end();
      if (dragged.current) commit(id, target);
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') end(); };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', key);
      stop.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', key);
    stop.current = end;
  };

  const onKey = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>, id: DominoId) => {
    dragged.current = false;
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const target = shown.indexOf(id) + (e.key === 'ArrowLeft' ? -1 : 1);
    if (target < 0 || target >= shown.length) return;
    commit(id, target);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-id="${id}"] button`)?.focus());
  };

  const tiles = drag ? arranged(hand, moved(order, hand, drag.id, drag.target)) : shown;
  return (
    <div class="hand drag-arrange" ref={root} aria-label="Your hand">
      <Tiles tiles={tiles} drag={drag} legal={legal} humanTurn={humanTurn} showHints={showHints} onDown={onDown} onKey={onKey}
        onTap={id => { if (dragged.current) dragged.current = false; else onPlay(id); }} />
      <span class="drag-arrange-said" role="status">{said}</span>
    </div>
  );
}
