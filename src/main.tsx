import { AccountPage } from './account/Account';
import { AccountDemo } from './account/AccountDemo';
import { render } from 'preact';
import { Ideas } from './ideas/Ideas';
import { IdeasDemo } from './ideas/IdeasDemo';
import { IDEA_ID } from './ideas/model';
import { ideasLink } from './ideas/client';
import { App } from './ui/App';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root');
const params = new URLSearchParams(location.search);
const previewIdea = params.get('idea');
const game = <App />;
render(params.has('account') ? (params.get('demo') === 'invite' ? <AccountDemo /> : <AccountPage />) : params.has('ideas') ? (params.get('demo') === 'bidding' ? <IdeasDemo /> : <Ideas />) : previewIdea && IDEA_ID.test(previewIdea) ? (
  <div class="idea-preview-shell">
    <aside class="idea-preview-bar"><span>Preview</span><a href={ideasLink(previewIdea)}>Tell us what you think →</a></aside>
    <div class="idea-preview-game">{game}</div>
  </div>
) : game, root);
