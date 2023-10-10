import { ReadonlySignal, Signal } from "@preact/signals";
import { Card, CardCategory, Knowledge, Player, Suggestion } from "../logic";
import { CreateSuggestionForm } from "./forms/CreateSuggestionForm";
import { SuggestionLabel } from "./utils/SuggestionLabel";
import { Either } from "effect";
import { LogicalParadox } from "../logic/LogicalParadox";

export function Suggestions({
    idsToLabels,
    players,
    cardsByCategory,
    suggestions,
    deducedKnowledge,
}: {
    idsToLabels: ReadonlySignal<Record<string, string>>;
    players: ReadonlySignal<Player[]>;
    cardsByCategory: ReadonlySignal<Record<CardCategory, Card[]>>;
    suggestions: Signal<Suggestion[]>;
    deducedKnowledge: ReadonlySignal<
        Either.Either<{ paradox: LogicalParadox; fallbackKnowledge: Knowledge }, Knowledge>
    >;
}) {
    return (<>
        <h2>Suggestions</h2>

        <ol>
            {suggestions.value.length > 0 && suggestions.value.map(suggestion => (
                <li>
                    <SuggestionLabel
                        idsToLabels={idsToLabels}
                        suggestion={suggestion}
                        deducedKnowledge={deducedKnowledge}
                    />
                </li>
            ))}

            {suggestions.value.length <= 0 && (
                <i>No suggestions</i>
            )}

            <li>
                <CreateSuggestionForm
                    idsToLabels={idsToLabels}
                    players={players}
                    allCardsByCategory={cardsByCategory}
                    onSubmit={(suggestion) => {
                        suggestions.value = [...suggestions.value, suggestion];
                    }}
                />
            </li>
        </ol>
    </>);
}
