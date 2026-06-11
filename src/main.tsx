import { render } from 'preact';
import { App } from './ui/App';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root');
render(<App />, root);
