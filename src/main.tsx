import { render } from 'preact';
import { App } from './ui/App';
import { Rooms } from './room/Rooms';
import { ROOMS_ENABLED } from './room/client';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root');
render(ROOMS_ENABLED && new URLSearchParams(location.search).has('rooms') ? <Rooms /> : <App />, root);
