import { render } from 'preact';
import './style.css';

export function App() {
	return (
		<>
			<aside class="game-setup">
				<section class="panel players">
					<h2>Players</h2>
				</section>

				<section class="panel cards">
					<h2>Cards</h2>
				</section>
			</aside>

			<main class="panel checklist">
				<h2>Checklist</h2>
			</main>

			<aside class="panel guesses">
				<h2>Guesses</h2>
			</aside>
		</>
	);
}

let container;
if (container = document.getElementById('app')) {
	render(<App />, container);
}

