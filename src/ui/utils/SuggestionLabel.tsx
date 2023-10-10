import { ReadonlySignal, useComputed } from "@preact/signals";
import { Card, Knowledge, Suggestion } from "../../logic";
import { Either, ReadonlyArray, identity } from "effect";
import { LogicalParadox } from "../../logic/LogicalParadox";
import { ApiKnownPlayerOwnershipKey } from "../../logic/Api";

export function SuggestionLabel({
    idsToLabels,
    suggestion,
    deducedKnowledge,
}: {
    idsToLabels: ReadonlySignal<Record<string, string>>;
    suggestion: Suggestion;
    deducedKnowledge: ReadonlySignal<
        Either.Either<{ paradox: LogicalParadox; fallbackKnowledge: Knowledge }, Knowledge>
    >;
}) {
    const [guesser, cards, nonRefuters, refuter, seenRefuteCard] = suggestion;

    const getLabel = useComputed(() => (id: string): string =>
        idsToLabels.value[id],
    );

    const knowledge = useComputed(() => Either.match(deducedKnowledge.value, {
        onLeft: ({ fallbackKnowledge }) => fallbackKnowledge,
        onRight: identity,
    }));

    const possibleRefuteCards = useComputed(() => {
        debugger;
        if (!refuter) {
            return {
                notOwned: ReadonlyArray.empty<Card>(),
                unknown: ReadonlyArray.empty<Card>(),
                owned: ReadonlyArray.empty<Card>(),
            };
        }

        return cards.reduce(({ notOwned, unknown, owned }, card) => {
            const ownership = knowledge.value.knownPlayerOwnerships[ApiKnownPlayerOwnershipKey(refuter, card)];

            if (ownership === "Y") {
                return {
                    notOwned,
                    unknown,
                    owned: [...owned, card],
                };
            }

            if (ownership === "N") {
                return {
                    notOwned: [...notOwned, card],
                    unknown,
                    owned,
                };
            }

            return {
                notOwned,
                unknown: [...unknown, card],
                owned,
            };
        }, {
            notOwned: ReadonlyArray.empty<Card>(),
            unknown: ReadonlyArray.empty<Card>(),
            owned: ReadonlyArray.empty<Card>(),
        });
    });

    return (<div>
        <div>
            <span>{getLabel.value(guesser)} suggested</span>
            <span> {cards.map(([, card]) => getLabel.value(card)).join(', ')}.</span>
        </div>

        {nonRefuters.length > 0 && (
            <div>
                <span>{nonRefuters.map(getLabel.value).join(', ')} passed.</span>
            </div>
        )}

        <div>
            {refuter
                ? (<span>{getLabel.value(refuter)} refuted</span>)
                : (<span><i>Nobody</i> refuted</span>)
            }

            {seenRefuteCard
                ? (<span> with {getLabel.value(seenRefuteCard[1])}</span>)
                : (refuter && <span> with <i>unknown</i> card</span>)
            }.
        </div>
        
        {refuter && !seenRefuteCard && (
            <div>
                {possibleRefuteCards.value.notOwned.length > 0 && (
                    <div>
                        <span>{getLabel.value(refuter)} does not own</span>
                        <span> {possibleRefuteCards.value.notOwned.map(([, card]) => getLabel.value(card)).join(', ')}.</span>
                    </div>
                )}

                {possibleRefuteCards.value.owned.length > 0 && (
                    <div>
                        <span>{getLabel.value(refuter)} owns</span>
                        <span> {possibleRefuteCards.value.owned.map(([, card]) => getLabel.value(card)).join(', ')}.</span>
                    </div>
                )}

                {possibleRefuteCards.value.unknown.length > 0 && (
                    <div>
                        <span>{getLabel.value(refuter)} may or may not own</span>
                        <span> {possibleRefuteCards.value.unknown.map(([, card]) => getLabel.value(card)).join(', ')}.</span>
                    </div>
                )}
            </div>
        )}
    </div>);
}
