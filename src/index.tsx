import { render } from 'preact';

import 'normalize.css';
import './style.css';

import { Clue } from './ui/Clue';

export function App() {
	return <Clue />;
}

const container = document.getElementById('app');
if (container) {
	render(<App />, container);
}
