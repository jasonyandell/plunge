import { useEffect, useRef, useState } from 'preact/hooks';
import { ideasLink } from './client';

export function IdeaShare({ id, link = ideasLink(id) }: { id: string; link?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (status === 'manual') input.current?.focus();
  }, [status]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  };
  return <div class="idea-share">
    <a class="idea-share-link" href={link}>Link to this idea</a>
    <button class="big-btn secondary" type="button" onClick={() => void copy()}>Copy link</button>
    <p class="idea-help" role="status">{status === 'copied' ? 'Link copied. Send it to your family.'
      : status === 'manual' ? 'Copy the link below to share this idea.' : 'Share this idea with your family.'}</p>
    {status === 'manual' && <label>Link to this idea
      <input ref={input} type="text" readOnly value={link} onFocus={event => event.currentTarget.select()} />
    </label>}
  </div>;
}
