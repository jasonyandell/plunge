import { LIVE_PLUNGE, type IdeaMessage, type IdeaThread } from './model';
import { ideaResult } from './result';

export function IdeaResult({ thread, message, onTry, busy }: { thread: IdeaThread; message: IdeaMessage; onTry: () => void; busy: boolean }) {
  const result = ideaResult(thread, message);
  if (!result) return null;
  const request = result.request.body;
  return <div class="idea-result">
    <p class="idea-result-request">In reply to {result.request.name}: “{request.length > 240 ? `${request.slice(0, 237)}…` : request}”</p>
    <p role="status" aria-live="polite" aria-atomic="true"><strong>{result.detail}</strong></p>
    {result.ready && <button class="big-btn" type="button" disabled={busy} onClick={onTry}>Try this update →</button>}
    {result.shipped && <a class="big-btn" href={LIVE_PLUNGE}>Play the updated game</a>}
  </div>;
}
