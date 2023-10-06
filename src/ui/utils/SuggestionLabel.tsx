import { ReadonlySignal, useComputed } from "@preact/signals";
import { Suggestion } from "../../logic";

export function SuggestionLabel({
    idsToLabels,
    suggestion,
}: {
    idsToLabels: ReadonlySignal<Record<string, string>>;
    suggestion: Suggestion;
}) {
    const [guesser, cards, nonRefuters, refuter, seenRefuteCard] = suggestion;

    const getLabel = useComputed(() => (id: string): string =>
        idsToLabels.value[id],
    );

    return (<div>
        <div>
            <span>{getLabel.value(guesser)} suggested</span>
            <span> {cards.map(([, card]) => getLabel.value(card)).join(', ')}.</span>
        </div>

        {nonRefuters.length > 0 && (
            <div>
                <span>{nonRefuters.join(', ')} passed.</span>
            </div>
        )}

        <div>
            {refuter
                ? (<span>{getLabel.value(guesser)} refuted</span>)
                : (<span><i>Nobody</i> refuted</span>)
            }

            {seenRefuteCard
                ? (<span> with {getLabel.value(seenRefuteCard[1])}</span>)
                : (refuter && <span> with <i>unknown</i> card</span>)
            }.
        </div>
    </div>);
}
