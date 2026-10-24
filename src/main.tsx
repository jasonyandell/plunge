import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { App } from './ui/App';
import { QuickIdea } from './ideas/QuickIdea';
import { IDEA_ID } from './ideas/model';
import { ideasLink } from './ideas/client';

// The stats, account and ideas pages are separate URL modes, so they load on
// demand and stay out of the first screen's JS. Their chunks are precached with
// the rest of the build (vite.config.ts), so they still work offline.
function Lazy({ load }: { load: () => Promise<JSX.Element> }) {
  const [node, setNode] = useState<JSX.Element | null>(null);
  useEffect(() => { load().then(setNode); }, []);
  return node;
}

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root');
const params = new URLSearchParams(location.search);
const previewIdea = params.get('idea');
const game = <App />;
const page = params.has('stats') ? <Lazy load={() => import('./stats/StatsPage').then(({ StatsPage }) => <StatsPage demo={params.get('demo') === 'stats'}/>)} /> : params.has('account') ? (params.get('demo') === 'invite' ? <Lazy load={() => import('./account/AccountDemo').then(({ AccountDemo }) => <AccountDemo />)} /> : <Lazy load={() => import('./account/Account').then(({ AccountPage }) => <AccountPage />)} />) : params.has('ideas') ? (params.get('demo') === 'bidding' ? <Lazy load={() => import('./ideas/IdeasDemo').then(({ IdeasDemo }) => <IdeasDemo />)} /> : <Lazy load={() => import('./ideas/Ideas').then(({ Ideas }) => <Ideas />)} />) : previewIdea && IDEA_ID.test(previewIdea) ? (
  <div class="idea-preview-shell">
    <aside class="idea-preview-bar"><span>Preview</span><a href={ideasLink(previewIdea)}>Tell us what you think →</a></aside>
    <div class="idea-preview-game">{game}</div>
  </div>
) : game;
render(<>{page}<QuickIdea /></>, root);
