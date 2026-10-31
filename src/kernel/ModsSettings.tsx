import { MODS } from '../mods';
import { keepLinkMods, setModOn, useMods } from './mods';

/** The More screen's list of mods, each with its switch. */
export function ModsSettings() {
  const { enabled, link } = useMods();
  if (!MODS.length) return null;
  const fromLink = MODS.filter(m => m.id in link);
  return (
    <section class="more-section" aria-labelledby="more-mods">
      <h2 id="more-mods">Mods</h2>
      <p class="setting-hint">Extras made by family, off unless you turn them on. Your choice stays on this device.</p>
      {MODS.map(mod => (
        <div class="setting" key={mod.id}>
          <button type="button" role="switch" class="thinking-switch"
            aria-checked={enabled.has(mod.id)} aria-describedby={`mod-${mod.id}-hint`}
            onClick={() => setModOn(mod.id, !enabled.has(mod.id))}>
            <span>{mod.title}</span>
            <span class="switch-track" aria-hidden="true"><span /></span>
          </button>
          <p id={`mod-${mod.id}-hint`} class="setting-hint">
            {mod.summary}{mod.id in link && ` ${link[mod.id] ? 'On' : 'Off'} for this visit, from your link.`}
          </p>
        </div>
      ))}
      {fromLink.length > 0 && <button type="button" class="more-row" onClick={keepLinkMods}>Keep it</button>}
    </section>
  );
}
