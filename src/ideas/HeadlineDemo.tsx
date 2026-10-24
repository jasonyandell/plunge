import { useState } from 'preact/hooks';
import { headlineExamples } from './headline-demo';
import { ideaPresentation } from './presentation';
import '../ui/app.css';
import '../ui/home.css';
import './ideas.css';

/** Uses the board's real title formatter without accounts or saved-game writes. */
export function HeadlineDemo() {
  const [request, setRequest] = useState(headlineExamples[0]!.request);
  const {title, tags} = ideaPresentation({title:request, number:34});
  return <main class="ideas-page">
    <header class="ideas-top"><a href="/?play=1">← Play Plunge</a><span>Idea headline demo</span></header>
    <div class="ideas-heading"><p class="eyebrow">Try this change</p><h1>Headlines for ideas</h1>
      <p>Edit a request and see the title that appears on its idea card.</p></div>
    <section class="idea-paper" aria-labelledby="headline-request-title">
      <h2 id="headline-request-title">Try your wording</h2>
      <label for="headline-request">Original request</label>
      <textarea id="headline-request" value={request} maxLength={100} aria-describedby="headline-help"
        onInput={event=>setRequest(event.currentTarget.value)} />
      <p id="headline-help" class="idea-help">This is a sample. Nothing is posted or saved.</p>
      <div class="headline-result" aria-live="polite" aria-atomic="true">
        <span class="idea-meta">Idea-card headline</span>
        <h2>{request.trim() ? title : 'Type a request to see its headline'}</h2>
        {request.trim() && <ul class="idea-tags" aria-label="Topics">{tags.map(tag=><li key={tag}>{tag}</li>)}</ul>}
      </div>
    </section>
    <section class="idea-paper" aria-labelledby="headline-examples-title">
      <h2 id="headline-examples-title">Try other stories</h2>
      <p class="idea-help">Sample requests based on other Plunge changes: naming the high bidder, reviewing completed hands, and waiting for everyone between hands.</p>
      <div class="headline-examples" role="group" aria-label="Sample requests">
        {headlineExamples.map(example=><button key={example.label} type="button" class="big-btn secondary"
          aria-pressed={request===example.request} onClick={()=>setRequest(example.request)}>{example.label}</button>)}
      </div>
    </section>
  </main>;
}
