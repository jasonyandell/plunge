import { useState } from 'preact/hooks';
import { MODS } from '../mods';
import { MOD_CATEGORIES, type ModManifest } from './mod-api';
import { keepLinkMods, setModOn, useMods } from './mods';
import { slotConflicts } from './Slot';

const SCOPE_WORDS: Record<ModManifest['scope'], string> = {
  device: 'Just this device: nobody else at the table sees a change.',
};

/** Mods matching `query` (title, summary or details, any case), by category in MOD_CATEGORIES
 * order and MODS order within; categories with none are left out. */
export function modGroups(query: string, mods: readonly ModManifest[] = MODS) {
  const q = query.trim().toLowerCase();
  const hit = (m: ModManifest) => !q || [m.title, m.summary, m.details].some(s => s.toLowerCase().includes(q));
  return MOD_CATEGORIES.map(category => ({ category, mods: mods.filter(m => m.category === category.id && hit(m)) }))
    .filter(g => g.mods.length > 0);
}

/** "On for this visit, from your link: …" for the top of the section, or null. */
export function linkNotice(link: Readonly<Record<string, boolean>>, mods: readonly ModManifest[] = MODS): string | null {
  const said = (on: boolean) => {
    const titles = mods.filter(m => link[m.id] === on).map(m => m.title);
    return titles.length ? `${on ? 'On' : 'Off'} for this visit, from your link: ${titles.join(', ')}.` : '';
  };
  return [said(true), said(false)].filter(Boolean).join(' ') || null;
}

export interface ModsListProps {
  mods: readonly ModManifest[];
  enabled: ReadonlySet<string>;
  link: Readonly<Record<string, boolean>>;
  query: string;
  open: string | null;
  onQuery: (query: string) => void;
  onOpen: (id: string | null) => void;
  onSwitch: (id: string, on: boolean) => void;
  /** Keep one mod's link choice; null keeps them all. */
  onKeep: (id: string | null) => void;
}

/** No hooks, so tests can call it as a plain function. */
export function ModsList({ mods, enabled, link, query, open, onQuery, onOpen, onSwitch, onKeep }: ModsListProps) {
  if (!mods.length) return null;
  const groups = modGroups(query, mods), notice = linkNotice(link, mods), conflicts = slotConflicts(enabled, mods);
  const title = (id: string) => mods.find(m => m.id === id)?.title ?? id;
  return (
    <section class="more-section mods-settings" aria-labelledby="more-mods">
      <h2 id="more-mods">Mods</h2>
      <p class="setting-hint">Extras for the table. Ones made by family stay off unless you turn them on. Your choice stays on this device.</p>
      {notice && <div class="mods-link" role="status">
        <p class="setting-hint">{notice}</p>
        <button type="button" class="more-row" onClick={() => onKeep(null)}>Keep it</button>
      </div>}
      <input type="search" class="mods-search" aria-label="Search mods" placeholder="Search mods" value={query}
        autoCapitalize="none" autoCorrect="off" spellcheck={false} onInput={e => onQuery(e.currentTarget.value)} />
      {groups.length === 0 && <p class="setting-hint mods-empty">No mods match.</p>}
      {groups.map(({ category, mods: shown }) => (
        <div class="mods-group" key={category.id} data-category={category.id}>
          <h3 id={`mods-${category.id}`}>{category.title}</h3>
          <p class="setting-hint">{category.gist}</p>
          <ul class="mods-rows" aria-labelledby={`mods-${category.id}`}>
            {shown.map(mod => {
              const on = enabled.has(mod.id), expanded = open === mod.id;
              return (
                <li class="mod-row" key={mod.id} data-mod={mod.id}>
                  <div class="mod-row-head">
                    <button type="button" class="mod-row-open" aria-expanded={expanded} aria-controls={`mod-${mod.id}-details`}
                      onClick={() => onOpen(expanded ? null : mod.id)}>
                      <span class="mod-row-title">{mod.title}</span>
                      <span class="mod-row-summary">{mod.summary}</span>
                    </button>
                    <button type="button" role="switch" class="thinking-switch mod-switch" aria-checked={on} aria-label={mod.title}
                      onClick={() => onSwitch(mod.id, !on)}>
                      <span class="switch-track" aria-hidden="true"><span /></span>
                    </button>
                  </div>
                  {mod.id in link && <p class="setting-hint mod-row-note">
                    {link[mod.id] ? 'On' : 'Off'} for this visit, from your link.{' '}
                    <button type="button" class="text-btn" onClick={() => onKeep(mod.id)}>Keep it</button>
                  </p>}
                  {conflicts.filter(c => c.mod === mod.id).map(c =>
                    <p class="setting-hint mod-row-note" key={c.slot}>Its {c.slot} is not shown: {title(c.owner)} already replaces it.</p>)}
                  <div class="mod-details" id={`mod-${mod.id}-details`} hidden={!expanded}>
                    <p>{mod.details}</p>
                    <p class="setting-hint">{SCOPE_WORDS[mod.scope]}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** The More screen's mods: grouped, searchable, each row with its switch and details. */
export function ModsSettings() {
  const { enabled, link } = useMods();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  return <ModsList mods={MODS} enabled={enabled} link={link} query={query} open={open}
    onQuery={setQuery} onOpen={setOpen} onSwitch={setModOn}
    onKeep={id => id === null ? keepLinkMods() : setModOn(id, link[id]!)} />;
}
