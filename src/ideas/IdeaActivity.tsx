import { useMemo } from 'preact/hooks';
import type { IdeaCard } from './model';
import { ideaActivity } from './activity';
export function IdeaActivity({card,now,connected,compact=false}:{card:IdeaCard;now:number;connected:boolean;compact?:boolean}) {
  // Use server-relative age plus time since receipt, so a mis-set phone clock is harmless.
  const receivedAt=useMemo(()=>Date.now(),[card]);
  const state=ideaActivity(card,now-receivedAt,connected);
  return <span class={`idea-activity ${state.tone}${compact?' compact':''}`}>
    <span class="idea-activity-label" role={compact?undefined:'status'} aria-live={compact?undefined:'polite'}>
      <span class="idea-activity-dot" aria-hidden="true"/><strong>{state.label}</strong>
    </span>
    {!compact && <span class="idea-activity-detail">{state.detail}</span>}
    {state.lastSeen && <span class="idea-activity-time">{state.lastSeen}</span>}
  </span>;
}
