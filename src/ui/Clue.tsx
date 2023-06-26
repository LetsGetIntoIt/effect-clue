import { signal } from "@preact/signals";

import './Clue.css';

export function Clue() {
	const standardCards = signal<'North America' | undefined>('North America');

	const cards = signal<[string, string][]>([
		['Room', 'Dog house'],
	]);

	const players = signal<[string][]>([
		['Kapil'],
		['Kate'],
	]);

	return (
		<>
			<aside class="game-setup">
				<section class="panel players">
					<h2>Players</h2>
					
					{players.value.map(player => (
						<input type="text" value={player[0]} disabled />
					))}
				</section>

				<section class="panel cards">
					<h2>Cards</h2>

					<input id="standardCards" type="checkbox" checked={standardCards.value === 'North America'} label="North America" disabled />
					<label for="#standardCards">North America set</label>

					{cards.value.map(card => (
						<input type="text" value={`${card[0]}: ${card[1]}`} disabled />
					))}
				</section>
			</aside>

			<main class="panel checklist">
				<h2>Checklist</h2>

				<table>
					<thead>
						<tr>
							{/* Blank heading for the cards row */}
							<th/>

							{/* Player name column headings */}
							{players.value.map(([playerName]) => <th>
								<h3>{playerName}</h3>
								<label>_ cards</label>
							</th>)}
						</tr>
					</thead>

					{cards.value.map(([cardType, cardName]) => (
						<tr>
							<th>
								<h3>{cardName}</h3>
								<label>{cardType}</label>
							</th>

							{players.value.map(([playerName]) => (<td>
								'yes/no'
							</td>))}
						</tr>
					))}
				</table>
			</main>

			<aside class="panel guesses">
				<h2>Guesses</h2>
			</aside>
		</>
	);
}
