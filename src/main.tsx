import { render } from 'preact';
import { Ideas } from './ideas/Ideas';
import { IDEA_ID } from './ideas/model';
import { ideasLink } from './ideas/client';
import { App } from './ui/App';
import { Rooms } from './room/Rooms';
import { ROOMS_ENABLED } from './room/client';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root');
const params = new URLSearchParams(location.search);
const previewIdea = params.get('idea');
const game = ROOMS_ENABLED && params.has('rooms') ? <Rooms /> : <App />;
render(params.has('ideas') ? <Ideas /> : previewIdea && IDEA_ID.test(previewIdea) ? (
  <div class="idea-preview-shell">
    <aside class="idea-preview-bar"><span>Preview</span><a href={ideasLink(previewIdea)}>Tell us what you think →</a></aside>
    <div class="idea-preview-game">{game}</div>
  </div>
) : game, root);
