import { computed, useSignal } from "@preact/signals";

import { signalToInput } from "./utils/signals";

import InputTextList from "./components/utils/InputTextList";

import './Clue.module.css';
import ChecklistTable from "./components/ChecklistTable";

export function Clue() {
	const caseFileLabel = useSignal<string>('Murder');
	const playerNames = useSignal<string[]>(['Kapil', 'Kate', 'Karthik']);
	const cards = useSignal<[string, string][]>([
		['Room', 'Living room'],
		['Weapon', 'Wrench'],
		['Weapon', 'Knife'],
		['Suspect', 'Plum'],
	]);

	const owners = computed(() => [caseFileLabel.value, ...playerNames.value]);

	return (
		<main class="clue">
			<aside class="game-setup">
				<section class="panel">
					<h2>Case file</h2>
					<input type="text" value={caseFileLabel.value} onInput={evt => caseFileLabel.value = evt?.target.value} />
				</section>

				<section class="panel">
					<h2>Players</h2>
					<InputTextList
						{...signalToInput(playerNames)}
						placeholderCreate="Add player"
						confirmRemove="Are you sure you want to remove this player?"
					/>
				</section>

				<section class="panel">
					<h2>Cards</h2>
					<InputTextList
						value={cards.value.map(([type, label]) => `${type}:${label}`)}
						onChange={newCards => cards.value = newCards.map(card => card.split(':') as [string, string])}
						placeholderCreate="Add card"
						confirmRemove="Are you sure you want to remove this card?"
					/>
				</section>
			</aside>

			<main class="panel checklist">
				<h2>Checklist</h2>
				<ChecklistTable
					owners={owners.value}
					cards={cards.value}
				/>
			</main>

			<aside class="panel guesses">
				<h2>Guesses</h2>
			</aside>
		</main>
	);
}
