import { useEffect, useRef } from 'preact/hooks';
import type { ComfortSettings } from './comfort';

export function ComfortControls({ settings, onChange, onClose }: {
  settings: ComfortSettings;
  onChange: (settings: ComfortSettings) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const current = dialog.current;
    current?.showModal();
    return () => { current?.close(); if (previous instanceof HTMLElement) previous.focus({ preventScroll: true }); };
  }, []);
  const toggle = (key: 'enabled' | 'pauseAfterTrick' | 'reduceMotion', label: string, help: string) => (
    <div class="comfort-setting">
      <button type="button" class="comfort-switch" role="switch" aria-checked={settings[key]}
        aria-describedby={`comfort-${key}`} onClick={() => onChange({ ...settings, [key]: !settings[key] })}>
        <span>{label}</span><span class="comfort-switch-value" aria-hidden="true">{settings[key] ? 'On' : 'Off'}</span>
      </button>
      <p id={`comfort-${key}`}>{help}</p>
    </div>
  );
  return <dialog ref={dialog} class="comfort-dialog" aria-labelledby="comfort-title"
    onCancel={e => { e.preventDefault(); onClose(); }}>
    <p class="eyebrow">Make yourself comfortable</p>
    <h2 id="comfort-title">Comfort controls</h2>
    <p>Bigger dominoes, room between buttons, and a chance to check each choice. Your game waits while you adjust.</p>
    {toggle('enabled', 'Use Comfort controls', 'Tap a domino, then Play. Bids and trump choices also wait for confirmation.')}
    {settings.enabled && <>
      <label class="comfort-setting comfort-repeat">Ignore quick repeat taps
        <select value={settings.repeatTapMs} onChange={e => onChange({ ...settings,
          repeatTapMs: Number(e.currentTarget.value) as ComfortSettings['repeatTapMs'] })}>
          <option value={0}>Off</option><option value={300}>Brief · 0.3 seconds</option><option value={600}>Longer · 0.6 seconds</option>
        </select>
        <span>Try Longer if one touch sometimes registers twice.</span>
      </label>
      {toggle('pauseAfterTrick', 'Wait after each trick', 'See who won, then tap Continue when you’re ready.')}
      {toggle('reduceMotion', 'Keep the table still', 'Turn off decorative movement and tile animations.')}
    </>}
    <p class="comfort-local">Saved on this device. Change these any time from the table.</p>
    <div class="comfort-dialog-footer"><button type="button" class="big-btn" onClick={onClose}>Done</button></div>
  </dialog>;
}
