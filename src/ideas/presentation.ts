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

export function ideaPresentation(card: IdeaCard) {
  const tags = topics.filter(topic => topic.match.test(card.title)).slice(0, 3).map(topic => topic.label);
  if (!tags.length) tags.push('Suggestion');
  let title: string;
  if (/\b(dashboard)\b/i.test(card.title) && tags.includes('Community')) title = 'Community ideas dashboard';
  else if (/\b(prior|past|earlier) hands\b/i.test(card.title)) title = 'Review this game’s hands';
  else if (/\bshare\b|\blinks?\b/i.test(card.title) && /\bideas?|tickets?\b/i.test(card.title)) title = 'Share ideas and demos';
  else if (/\bzeb\b/i.test(card.title)) title = 'Play with Zeb';
  else if (/\bScifigoofy.+playground/i.test(card.title)) title = 'Scifigoofy’s playground';
  else if (/\bbid\b/i.test(card.title) && /\b(see|visible|visibility)\b/i.test(card.title)) title = 'Visible bids';
  else {
    // Make a short, readable title from the request's keywords, without needing a service.
    const words = card.title.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? [];
    const filler = /^(i|i’m|i'm|i’d|i'd|we|we’re|we're|you|your|my|our|me|us|a|an|the|this|that|it|its|is|are|be|been|was|were|to|for|of|in|on|at|and|or|but|with|as|by|from|can|can't|can’t|could|would|should|will|want|like|please|make|let|have|has|need|add|get|give|do|does|let’s|let's)$/i;
    const keywords = words.filter(word => !filler.test(word)).slice(0, 6);
    const short = keywords.join(' ');
    title = short ? short.charAt(0).toLocaleUpperCase() + short.slice(1) : `Community idea ${card.number}`;
  }
  return {title, tags};
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
