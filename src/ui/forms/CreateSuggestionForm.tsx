import { ReadonlySignal, useComputed, useSignal } from "@preact/signals";
import { Card, Player, Suggestion } from "../../logic";
import { useId } from "preact/hooks";
import { SuggestionLabel } from "../utils/SuggestionLabel";

export function CreateSuggestionForm({
    idsToLabels,
    players: allPlayers,
    cards: allCards,
    onSubmit,
}: {
    idsToLabels: ReadonlySignal<Record<string, string>>;
    players: ReadonlySignal<Player[]>;
    cards: ReadonlySignal<Card[]>;
    onSubmit: (suggestion: Suggestion) => void;
}) {
    const suggestionDatalistId = useId();
    const allPossibleSuggestions = useComputed(() =>
        listAllPossibleSuggestions({
            players: allPlayers.value,
            cards: allCards.value,
        }),
    );

    const suggestion = useSignal<Suggestion | undefined>(undefined);

    return (
        <form
            onSubmit={(evt) => {
                if (!suggestion.value) {
                    return;
                }

                // Submit the card name
                onSubmit(suggestion.value);

                // Clear the inputs
                suggestion.value = undefined;

                // Prevent the browser from reloading
                evt.preventDefault();
            }}
        >
            <input list={suggestionDatalistId} />
            <datalist id={suggestionDatalistId}>
                {allPossibleSuggestions.value.map(suggestion => (
                    <option>
                        <SuggestionLabel idsToLabels={idsToLabels} suggestion={suggestion} />
                    </option>
                ))}
            </datalist>

            <button type="submit">Create</button>
        </form>
    );
}

const listAllPossibleSuggestions = ({
    players,
    cards,
}: {
    readonly players: readonly Player[];
    readonly cards: readonly Card[];
}): Suggestion[] => {
    return [];
}
