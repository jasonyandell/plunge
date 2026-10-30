import { IdeaActivity } from './IdeaActivity';
import { LIVE_PLUNGE, type IdeaCard } from './model';
import { hasIdeaDemo, ideaPresentation, matchesIdeaFilter, type IdeaFilter } from './presentation';

export interface IdeasBoardView {filter:IdeaFilter;query:string}
export function IdeasBoard({view, onView, cards, loaded = true, busy = false, demo = false, now, connected, onOpen, onTry}: {
  view:IdeasBoardView; onView:(view:IdeasBoardView)=>void; cards: IdeaCard[]; loaded?: boolean; busy?: boolean; demo?: boolean; now: number; connected: boolean;
  onOpen: (id: string) => void; onTry: (id: string) => void;
}) {
  const {filter,query}=view;
  const filters: {id: IdeaFilter; label: string}[] = [
    {id: 'current', label: 'Current ideas'}, {id: 'demos', label: 'Available demos'},
    {id: 'attention', label: 'Needs attention'}, {id: 'shipped', label: 'In the game'},
    {id: 'iced', label: 'On ice'}, {id: 'closed', label: 'Set aside'},
  ];
  const visible = cards.filter(card => {
    const {title, tags} = ideaPresentation(card);
    return matchesIdeaFilter(card, filter) && `${title} ${card.title} ${card.name} ${tags.join(' ')} ${card.number}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });
  return <section class="ideas-dashboard" aria-labelledby="ideas-board-title">
    <h2 id="ideas-board-title" class="ideas-board-label">Browse our ideas</h2>
    <div class="ideas-filters" role="group" aria-label="Browse ideas">
      {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => onView({...view,filter:item.id})}>
        <span>{item.label}</span><strong>{loaded ? cards.filter(card => matchesIdeaFilter(card, item.id)).length : '…'}</strong>
      </button>)}
    </div>
    <label class="ideas-search">Find an idea<input type="search" value={query} placeholder="Search ideas, people, or tags" onInput={event => onView({...view,query:event.currentTarget.value})} /></label>
    {!loaded ? <p role="status">Opening the board…</p> : <>
      <p class="ideas-result-count" role="status">{visible.length} of {cards.length} loaded ideas</p>
      {!visible.length ? <p class="ideas-empty">{!cards.length ? 'Our next idea starts with you. Share one below.' : filter === 'demos' && !query.trim() ? 'No demos are available here yet. Checked previews will appear here when they’re ready to try.' : 'No matching ideas. Try another search or browse current ideas.'}</p> :
        <div class="ideas-grid">{visible.map(card => {
          const {title, tags} = ideaPresentation(card);
          return <article key={card.id} class="idea-paper idea-card" aria-labelledby={`idea-title-${card.id}`}>
            <span class="idea-meta">{card.name} · Idea {card.number}</span>
            <h3 id={`idea-title-${card.id}`}><button type="button" disabled={busy} onClick={() => onOpen(card.id)}>{title}</button></h3>
            <ul class="idea-tags" aria-label="Topics">{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
            {demo && card.status === 'queued' ? <span class="idea-status">Demo idea saved</span> : <IdeaActivity card={card} now={now} connected={connected} compact />}
            <div class="idea-card-actions">
              {hasIdeaDemo(card) && <button type="button" class="big-btn" disabled={busy} aria-label={`Try demo: ${title}`} onClick={() => onTry(card.id)}>Try demo →</button>}
              {card.status === 'shipped' && <a class="big-btn" href={LIVE_PLUNGE}>Play in Plunge →</a>}
              <button type="button" class="idea-open" disabled={busy} aria-label={`Join conversation: ${title}`} onClick={() => onOpen(card.id)}>Join conversation →</button>
            </div>
          </article>;
        })}</div>}
    </>}
  </section>;
}
