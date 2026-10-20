import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { DominoId } from '../engine';
import { Domino, dominoAriaLabel } from './Domino';

interface HandProps {
  hand: readonly DominoId[];
  legal: ReadonlySet<DominoId>;
  humanTurn: boolean;
  showHints: boolean;
  onPlay: (id: DominoId) => void;
}

interface Drag {
  id: DominoId;
  pointer: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  slots: DOMRect[];
  signature: string;
  target: number;
  active: boolean;
}

/** Personal display order only: never reorder the engine's hands or send a room action. */
export function Hand({ hand, legal, humanTurn, showHints, onPlay }: HandProps) {
  const [order, setOrder] = useState<DominoId[]>([...hand]);
  const [dragView, setDragView] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [arrangeMode, setArranging] = useState(false);
  const [selected, setSelected] = useState<DominoId | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const visible = [...order.filter(id => hand.includes(id)), ...hand.filter(id => !order.includes(id))];
  const signature = hand.join(',');
  const arranging = arrangeMode && hand.length > 1;

  function cancel() {
    const current = drag.current;
    if (!current) return;
    suppressClick.current = true;
    drag.current = null;
    setDragView(null);
    if (root.current?.hasPointerCapture(current.pointer)) root.current.releasePointerCapture(current.pointer);
  }

  useEffect(() => { cancel(); }, [signature]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    const blur = () => cancel();
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', blur);
    };
  }, []);

  function move(id: DominoId, target: number) {
    const from = visible.indexOf(id);
    if (from < 0 || target < 0 || target >= visible.length || from === target) return;
    const next = visible.filter(tile => tile !== id);
    next.splice(target, 0, id);
    // Keep played tiles in the remembered order so an undo can restore them.
    const remembered = [...order, ...hand.filter(tile => !order.includes(tile))];
    let index = 0;
    setOrder(remembered.map(tile => hand.includes(tile) ? next[index++]! : tile));
    setAnnouncement(`${dominoAriaLabel(id)} moved to position ${target + 1} of ${visible.length}.`);
  }

  function start(event: JSX.TargetedPointerEvent<HTMLButtonElement>, id: DominoId) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    suppressClick.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top, width: rect.width, height: rect.height,
      slots: Array.from(root.current!.querySelectorAll<HTMLButtonElement>('.hand-tile'), tile => tile.getBoundingClientRect()),
      signature, target: visible.indexOf(id), active: false,
    };
  }

  function track(event: JSX.TargetedPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.signature !== signature) { cancel(); return; }
    if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 8) return;
    current.active = true;
    suppressClick.current = true;
    root.current!.setPointerCapture(event.pointerId);
    event.preventDefault();
    current.x = event.clientX;
    current.y = event.clientY;
    const bounds = root.current!.getBoundingClientRect();
    current.target = -1;
    if (current.x >= bounds.left - 12 && current.x <= bounds.right + 12
      && current.y >= bounds.top - 12 && current.y <= bounds.bottom + 12) {
      let nearest = Infinity;
      current.slots.forEach((slot, index) => {
        const distance = Math.hypot(current.x - (slot.left + slot.width / 2), current.y - (slot.top + slot.height / 2));
        if (distance < nearest) { nearest = distance; current.target = index; }
      });
    }
    setDragView({ ...current });
  }

  const selectedIndex = selected === null ? -1 : visible.indexOf(selected);
  return (
    <>
      <div class="hand" ref={root} role="group" aria-label="Your hand" aria-describedby={hand.length > 1 ? 'hand-arrange-help' : undefined}
        onPointerMove={track}
        onPointerUp={event => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          if (current.signature !== signature) { cancel(); return; }
          if (current.active) {
            track(event);
            move(current.id, current.target);
            cancel();
          } else drag.current = null;
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={event => { if (event.target === event.currentTarget) cancel(); }}
        onPointerLeave={() => { if (drag.current && !drag.current.active) cancel(); }}>
        {visible.map((id, index) => {
          const target = dragView?.target === index && dragView.id !== id;
          return (
            <button key={id} type="button"
              class={`hand-tile${dragView?.id === id ? ' hand-drag-source' : ''}${target ? (index > visible.indexOf(dragView!.id) ? ' hand-drop-after' : ' hand-drop-before') : ''}`}
              aria-label={dominoAriaLabel(id)} aria-describedby={hand.length > 1 ? 'hand-arrange-help' : undefined}
              aria-pressed={arranging ? selected === id : undefined}
              onPointerDown={event => start(event, id)}
              onKeyDown={event => {
                suppressClick.current = false;
                if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                  event.preventDefault();
                  move(id, index + (event.key === 'ArrowLeft' ? -1 : 1));
                  const button = event.currentTarget;
                  requestAnimationFrame(() => button.focus());
                }
              }}
              onClick={() => {
                if (suppressClick.current) return;
                if (arranging) { setSelected(id); return; }
                if (humanTurn && (!showHints || legal.has(id))) onPlay(id);
              }}>
              <Domino id={id} orientation="h" state={humanTurn && showHints ? (legal.has(id) ? 'legal' : 'illegal') : 'idle'} />
            </button>
          );
        })}
      </div>
      {hand.length > 1 && <div class="hand-arrange">
        <span id="hand-arrange-help">{arranging ? 'Select a tile, then move it.' : 'Drag to arrange.'}
          <span class="hand-sr-only"> Use Alt and the left or right arrow to move a focused tile. Escape cancels a drag.</span>
        </span>
        {arranging && <>
          <button type="button" disabled={selectedIndex <= 0} onClick={() => selected && move(selected, selectedIndex - 1)} aria-label="Move selected tile earlier">←</button>
          <button type="button" disabled={selectedIndex < 0 || selectedIndex >= visible.length - 1} onClick={() => selected && move(selected, selectedIndex + 1)} aria-label="Move selected tile later">→</button>
        </>}
        <button type="button" aria-pressed={arranging} onClick={() => { cancel(); setArranging(!arranging); setSelected(null); }}>{arranging ? 'Done' : 'Arrange'}</button>
      </div>}
      <span class="hand-sr-only" role="status">{announcement}</span>
      {dragView && <div class="hand-drag-ghost" aria-hidden="true" style={{
        left: dragView.x - dragView.offsetX, top: dragView.y - dragView.offsetY,
        width: dragView.width, height: dragView.height,
      }}><Domino id={dragView.id} orientation="h" /></div>}
    </>
  );
}
