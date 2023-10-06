import { ReadonlySignal, Signal } from "@preact/signals";
import { Card, Player, Suggestion } from "../logic";
import { CreateSuggestionForm } from "./forms/CreateSuggestionForm";
import { SuggestionLabel } from "./utils/SuggestionLabel";

export function Suggestions({
    idsToLabels,
    players,
    cards,
    suggestions,
}: {
    idsToLabels: ReadonlySignal<Record<string, string>>;
    players: ReadonlySignal<Player[]>;
    cards: ReadonlySignal<Card[]>;
    suggestions: Signal<Suggestion[]>;
}) {
    return (<>
        <h2>Suggestions</h2>

        <ol>
            {suggestions.value.length > 0 && suggestions.value.map(suggestion => (
                <li>
                    <SuggestionLabel idsToLabels={idsToLabels} suggestion={suggestion} />
                </li>
            ))}

            {suggestions.value.length <= 0 && (
                <i>No suggestions</i>
            )}

            <li>
                <CreateSuggestionForm
                    idsToLabels={idsToLabels}
                    players={players}
                    cards={cards}
                    onSubmit={(suggestion) => {
                        suggestions.value = [...suggestions.value, suggestion];
                    }}
                />
            </li>
        </ol>
    </>);
}
