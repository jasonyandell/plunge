import { useState } from 'preact/hooks';
import { currentPreview, previewSignInLink } from './preview-access';
import { LIVE_PLUNGE } from './model';

export function PreviewSignIn() {
  const embedded = window.top !== window;
  const preview = currentPreview();
  const [link,setLink] = useState(()=>{try {return embedded && preview ? `${location.origin}/?ideas=1` : preview ? previewSignInLink() : `${LIVE_PLUNGE}/?ideas=1`;} catch {return '';}});
  return <>
    {link ? <a class="big-btn" href={link} target="_blank" rel="noopener noreferrer" onClick={event=>{
      if (!preview || embedded) return;
      try {event.currentTarget.href=previewSignInLink();} catch {event.preventDefault();setLink('');}
    }}>{embedded && preview ? 'Open dashboard to sign in ↗' : preview ? 'Sign in with Plunge ↗' : 'Open real family ideas ↗'}</a>
      : <p role="alert">Allow browser storage, then reload to sign in to this demo.</p>}
    <p class="idea-help">{embedded && preview ? 'Open the dashboard in its own tab, then sign in with your real Plunge account.' : preview ? 'Opens real Plunge sign-in in a new tab. Then choose “Open dashboard demo” to return with your family access.' : 'Use your real Plunge account to open the family dashboard.'} Ideas and replies are shared with the family.</p>
  </>;
}
