import { previewFor, type IdeaMessage, type IdeaThread } from './model';

/** A mutable PR preview belongs only to the latest completed reply for this request. */
export function ideaResult(thread: IdeaThread, message: IdeaMessage) {
  if (message.role !== 'builder' || !message.result
    || thread.messages.filter(item => item.role === 'builder' && item.result).at(-1)?.id !== message.id) return null;
  const request = thread.messages.find(item => item.id === message.result!.requestId && item.role === 'family');
  if (!request) return null;
  const card = thread.card;
  const current = message.result.revision === card.revision;
  const ready = current && card.status === 'ready' && card.pr !== null && card.preview === previewFor(card.pr);
  const details = {
    queued: 'Your follow-up is saved. A new update will appear here after it is checked.',
    building: 'Your follow-up is being worked on. Its preview will appear with the reply that answers it.',
    checking: 'The change is written. Preview checks are running; this reply will update when you can try it.',
    ready: ready ? 'Preview ready for this reply. Use “Try this update” below.' : 'The preview link is not available yet.',
    failed: 'This update could not finish its checks. There is no new preview to try yet.',
    shipped: 'This update is now in the main game.',
    closed: 'This update has been set aside. Its preview is no longer available.',
    question: 'This reply is a question, so it did not create a new preview.',
  };
  return { request, ready, shipped: current && card.status === 'shipped',
    detail: current || card.status === 'queued' || card.status === 'building' ? details[card.status]
      : 'A newer request has replaced this update. Its preview is no longer available.' };
}
