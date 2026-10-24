import { previewFor, type IdeaCard } from './model';

// Display labels only: keep the family's original request and saved card untouched.
const topics = [
  { label: 'Appearance', match: /\b(blossom|bird|animation|mascot|background|congrats|playground)\b/i },
  { label: 'Sharing', match: /\b(share|sharing|links?|send|screenshot)\b/i },
  { label: 'History', match: /\b(history|prior|stats|review)\b/i },
  { label: 'Community', match: /\b(ideas?|community|dashboard|demos?)\b/i },
  { label: 'Bidding', match: /\b(bids?|bidder|bidding|auction|nello)\b/i },
  { label: 'Scoring', match: /\b(scores?|scoring|points?|marks?)\b/i },
  { label: 'Accessibility', match: /\b(read|readable|bigger|larger|contrast|colou?rs?|letters?|font|accessibility|see)\b/i },
  { label: 'Multiplayer', match: /\b(rooms?|friends?|multiplayer|invites?|partners?)\b/i },
  { label: 'Learning', match: /\b(hints?|learn|rules?|teach|tutorial|help)\b/i },
  { label: 'Gameplay', match: /\b(dominoes|dominos|hands?|tricks?|play|game)\b/i },
];

export function ideaPresentation(card: Pick<IdeaCard, 'title' | 'number'>) {
  const tags = topics.filter(topic => topic.match.test(card.title)).slice(0, 3).map(topic => topic.label);
  if (!tags.length) tags.push('Suggestion');
  return {title: ideaHeadline(card.title, card.number), tags};
}

function ideaHeadline(request: string, number: number): string {
  const original = request.replace(/\s+/g, ' ').trim();
  // Shorten conversational openings, not the words that carry the request's
  // meaning. Topic keywords alone cannot distinguish fixes from new features.
  let headline = original
    .replace(/^please\s+/i, '')
    .replace(/^(?:i|we)\s+(?:want|would like|need)\s+to\s+|^(?:i|we)[’']d like to\s+/i, '')
    .replace(/^(?:can|could|would) (?:you|we)\s+(?:please\s+)?/i, '')
    .replace(/^please\s+/i, '')
    .replace(/^see\s+/i, 'Show ')
    .replace(/^(?:the )?([^.!?:]+?) should be (.+)$/i, '$1: $2')
    .replace(/[.!?]+$/, '')
    .trim();
  if (!headline) headline = original;
  if (!headline) return `Community idea ${number}`;
  // Stored titles already fit this limit; longer browser-demo requests should
  // end on a whole word and visibly indicate that there is more to read.
  if (headline.length > 100) {
    const end = headline.lastIndexOf(' ', 99);
    headline = headline.slice(0, end > 0 ? end : 99).trimEnd() + '…';
  }
  return headline.charAt(0).toLocaleUpperCase() + headline.slice(1);
}

export function hasIdeaDemo(card: IdeaCard) {
  return card.status === 'ready' && Number.isSafeInteger(card.pr) && (card.pr ?? 0) > 0
    && card.preview?.replace(/\/$/, '') === previewFor(card.pr!) && /^[a-f0-9]{40}$/.test(card.sha ?? '');
}

export type IdeaFilter = 'current' | 'demos' | 'attention' | 'shipped' | 'closed';
export function matchesIdeaFilter(card: IdeaCard, filter: IdeaFilter) {
  switch (filter) {
    case 'current': return card.status !== 'closed';
    case 'demos': return hasIdeaDemo(card);
    case 'attention': return card.status === 'failed' || card.status === 'question';
    case 'shipped': return card.status === 'shipped';
    case 'closed': return card.status === 'closed';
  }
}
