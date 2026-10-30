import { previewFor, type IdeaCard } from './model';

/** A card's headline is its saved summary, shown as written. The builder or
 * Jason writes it; the family's own words stay first in the conversation. */
export function ideaTitle(card: Pick<IdeaCard, 'title' | 'number'>): string {
  return card.title.replace(/\s+/g, ' ').trim() || `Community idea ${card.number}`;
}

export function hasIdeaDemo(card: IdeaCard) {
  return card.status === 'ready' && Number.isSafeInteger(card.pr) && (card.pr ?? 0) > 0
    && card.preview?.replace(/\/$/, '') === previewFor(card.pr!) && /^[a-f0-9]{40}$/.test(card.sha ?? '');
}

export type IdeaFilter = 'current' | 'demos' | 'attention' | 'iced' | 'shipped' | 'closed';
export function matchesIdeaFilter(card: IdeaCard, filter: IdeaFilter) {
  switch (filter) {
    case 'current': return card.status !== 'closed' && card.status !== 'iced';
    case 'demos': return hasIdeaDemo(card);
    case 'attention': return card.status === 'failed' || card.status === 'question';
    case 'shipped': return card.status === 'shipped';
    case 'iced': return card.status === 'iced';
    case 'closed': return card.status === 'closed';
  }
}
