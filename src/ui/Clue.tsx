import { computed, effect, useSignal } from "@preact/signals";

import InputTextList from "./components/utils/InputTextList";
import ChecklistTable from "./components/ChecklistTable";

import * as Api from '../api';

import './Clue.module.css';

export function Clue() {
	const cards = useSignal<Api.Card[]>([
		['Room', 'Living room'],
		['Weapon', 'Wrench'],
		['Weapon', 'Knife'],
		['Suspect', 'Plum'],
	]);
	const players = useSignal<Api.Player[]>([['Kapil'], ['Kate'], ['Karthik']]);
	const caseFile = useSignal<Api.CaseFile>(['Murder']);

	const playerNumCards = useSignal<{ [player: string]: number }>({});
	const ownership = useSignal<{
		[playerCard: string]: boolean;
	}>({});

	const guesses = useSignal<Api.Guess[]>([]);

	const deductionRules = useSignal<Api.DeductionRule[]>([
		'cardIsHeldAtLeastOnce',
		'cardIsHeldAtMostOnce',
		'playerHasNoMoreThanMaxNumCards',
		'playerHasNoLessThanMinNumCards',
	]);

	const apiOutput = computed(() => Api.run({
		cards: cards.value,
		players: players.value,
		caseFile: caseFile.value,

		// TODO known numCards
		// TODO know card owners

		guesses: guesses.value,

		deductionRules: deductionRules.value,
	}));

	return (
		<main class="clue">
			<aside class="game-setup">
				<section class="panel">
					<h2>Case file</h2>
					<input type="text" value={caseFile.value} onInput={evt => caseFile.value = evt.target?.value} />
				</section>

				<section class="panel">
					<h2>Players</h2>
					<InputTextList
						value={players.value}
						onChange={newPlayers => players.value = newPlayers}
						placeholderCreate="Add player"
						confirmRemove="Are you sure you want to remove this player?"
					/>
				</section>

				<section class="panel">
					<h2>Cards</h2>
					<InputTextList
						value={cards.value.map(([type, label]) => `${type}:${label}`)}
						onChange={newCards => {
							cards.value = newCards.map(card => {
								const [cardType, cardName] = card.split(':');
								return [cardType, cardName];
							});
						}}
						placeholderCreate="Add card"
						confirmRemove="Are you sure you want to remove this card?"
					/>
				</section>
			</aside>

			<main class="panel checklist">
				<h2>Checklist</h2>
				<ChecklistTable
					caseFile={caseFile.value}
					players={players.value}
					cards={cards.value}

					playerNumCards={playerNumCards.value}
					onChangePlayerNumCards={(player, numCards) => {
						playerNumCards.value = {
							...playerNumCards.value,
							[player]: numCards,
						};
					}}

					onChangeOwnership={(player, [cardType, cardLabel], isOwned) => {
						if (isOwned === null || isOwned === undefined) {
							// Remove our information about the ownership
							const { [`${player}:${cardType}:${cardLabel}`]: _, ...newOwnership } = ownership.value;
							ownership.value = newOwnership;
						} else {
							ownership.value = {
								...ownership.value,
								[`${player}:${cardType}:${cardLabel}`]: isOwned,
							};
						}
					}}
					apiOutput={apiOutput.value}
				/>
			</main>

			<aside class="panel guesses">
				<h2>Guesses</h2>
			</aside>
		</main>
	);
}
