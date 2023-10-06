import { ReadonlySignal } from "@preact/signals";
import { Suggestion } from "../../logic";

export function SuggestionLabel({
    idsToLabels,
    suggestion,
}: {
    idsToLabels: ReadonlySignal<Record<string, string>>;
    suggestion: Suggestion;
}) {
    const [guesser, cards, refuter, seenRefuteCard] = suggestion;

    return (<>
        <span>{idsToLabels.value[guesser]} suggested</span>
        <span>{cards.map(([, card]) => idsToLabels.value[card]).join(', ')}</span>.
        <span>{refuter
            ? (<>{idsToLabels.value[guesser]} refuted</>)
            : (<>Nobody refuted</>)
        }</span>
        <span>{seenRefuteCard
            ? (<>with {idsToLabels.value[seenRefuteCard[0]]}</>)
            : (<>with unknown card</>)
        }</span>.
    </>);
}
