import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** A small invitation anchored to the play the player tapped. */
export function MoveQuestionPrompt({ target, label, onSave, onClose }: {
  target: HTMLElement;
  label: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const anchor = useRef(target.getBoundingClientRect());
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    const place = () => {
      if (target.isConnected) anchor.current = target.getBoundingClientRect();
      const rect = anchor.current;
      const size = popup.current?.getBoundingClientRect();
      if (!size) return;
      setPosition({
        left: Math.max(8, Math.min(rect.left + (rect.width - size.width) / 2, window.innerWidth - size.width - 8)),
        top: Math.max(8, Math.min(rect.top >= size.height + 16 ? rect.top - size.height - 8 : rect.bottom + 8, window.innerHeight - size.height - 8)),
      });
    };
    place();
    action.current?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [target]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !target.contains(event.target)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (target.isConnected) target.focus({ preventScroll: true });
      onClose();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [target, onClose]);

  return <div class="move-question-prompt" ref={popup} style={position} role="group" aria-label={label}>
    <span class="move-question-context">{label}</span>
    <button ref={action} type="button" onClick={() => {
      if (target.isConnected) target.focus({ preventScroll: true });
      onSave();
    }}>
      <strong>Why this move?</strong>
      <span>Save for later</span>
    </button>
  </div>;
}
