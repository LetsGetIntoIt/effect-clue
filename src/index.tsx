import { render } from 'preact';

import 'normalize.css';
import './style.css';

import { App } from './ui/App';

let container;
if (container = document.getElementById('app')) {
	render(<App />, container);
}
