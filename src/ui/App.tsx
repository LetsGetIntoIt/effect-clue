import './App.module.css';

import { Clue } from './Clue';

export function App() {
	return (
		<div class="surface app">
			<header>
				<h1>Welcome to our Clue Solver! <a href="https://www.youtube.com/playlist?list=PLbh8a41dlxTHhaZsqEd9J1dIftbsI77Z_">Follow the full series on Youtube</a></h1>
			</header>

			<Clue />
		</div>
	);
}
