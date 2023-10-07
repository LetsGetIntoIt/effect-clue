import styles from './CreateSuggestionForm.module.css';
import { ReadonlySignal, useComputed, useSignal } from "@preact/signals";
import { Card, CardCategory, Player, Suggestion } from "../../logic";
import { ReadonlyArray, ReadonlyRecord, pipe } from 'effect';

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
    const allCardsByCategory = useComputed((): Record<CardCategory, Card[]> => pipe(
        allCards.value,

        ReadonlyArray.reduce<Record<CardCategory, Card[]>, Card>(
            {},
            (cardsByCategory, card) => {
                const [category] = card;
                const otherCardsInCategory = cardsByCategory[category] ?? [];
                return {
                    ...cardsByCategory,
                    [category]: [...otherCardsInCategory, card] ,
                };
            }
        ),
    ));

    const guesser = useSignal<Player | undefined>(undefined);
    const cards = useSignal<Card[]>([]);
    const nonRefuters = useSignal<Player[]>([]);
    const refuter = useSignal<Player | undefined>(undefined);
    const seenRefuteCard = useSignal<Card | undefined>(undefined);

    return (
        <form
            className="create-suggestion-form"
            onSubmit={(evt) => {
                if (!guesser.value) {
                    return;
                }

                // Submit the card name
                onSubmit([
                    guesser.value,
                    cards.value,
                    nonRefuters.value,
                    refuter.value,
                    seenRefuteCard.value,
                ]);

                // Clear the inputs
                guesser.value = undefined,
                cards.value = [],
                nonRefuters.value = [],
                refuter.value = undefined,
                seenRefuteCard.value = undefined,

                // Prevent the browser from reloading
                evt.preventDefault();
            }}
        >
            <fieldset>
                <legend>Guesser</legend>
                {allPlayers.value.map(player => (
                    <label className={styles.toggleInput}>
                        <input
                            type="radio"
                            name="guesser"
                            value={player}
                            checked={guesser.value === player}
                            onClick={() => {
                                guesser.value = player;
                            }}
                        />
                        {idsToLabels.value[player]}
                    </label>
                ))}
            </fieldset>

            <fieldset>
                <legend>Cards</legend>
                {ReadonlyRecord.toEntries(allCardsByCategory.value)
                    .sort()
                    .map(([category, cardsInCategory]) => (<>
                        <label><strong>{idsToLabels.value[category]}</strong></label>

                        {cardsInCategory.map(card => (
                            <label className={styles.toggleInput}>
                                <input
                                    type="checkbox"
                                    name="cards"
                                    value={card}
                                    checked={Boolean(
                                        cards
                                            .value
                                            .find(selectedCard =>
                                                selectedCard[0] === card[0]
                                                && selectedCard[1] === card[1]
                                            )
                                    )}
                                    onClick={() => {
                                        if (cards
                                            .value
                                            .find(selectedCard =>
                                                selectedCard[0] === card[0]
                                                && selectedCard[1] === card[1]
                                            )
                                        ) {
                                            cards.value = cards.value.filter(selectedCard =>
                                                !(selectedCard[0] === card[0]
                                                && selectedCard[1] === card[1])
                                            );
                                        } else {
                                            cards.value = [...cards.value, card];
                                        }
                                    }}
                                />
                                {idsToLabels.value[card[1]]}
                            </label>
                        ))}
                    </>))
                }
            </fieldset>

            <fieldset>
                <legend>Non-refuters</legend>
                {allPlayers.value.map(player => (
                    <label className={styles.toggleInput}>
                        <input
                            type="checkbox"
                            name="nonRefuters"
                            value={player}
                            checked={nonRefuters.value.includes(player)}
                            onClick={() => {
                                if (nonRefuters.value.includes(player)) {
                                    nonRefuters.value = nonRefuters.value.filter(nonRefuter => nonRefuter !== player);
                                } else {
                                    nonRefuters.value = [...nonRefuters.value, player];
                                }
                            }}
                        />
                        {idsToLabels.value[player]}
                    </label>
                ))}
            </fieldset>

            <fieldset>
                <legend>Refutation</legend>

                <fieldset>
                    <legend>Refuter</legend>
                    {allPlayers.value.map(player => (
                        <label className={styles.toggleInput}>
                            <input
                                type="radio"
                                name="refuter"
                                value={player}
                                checked={refuter.value === player}
                                onClick={() => {
                                    refuter.value = player;
                                }}
                            />
                            {idsToLabels.value[player]}
                        </label>
                    ))}

                    <label className={styles.toggleInput}>
                        <input
                            type="radio"
                            name="refuter"
                            value={undefined}
                            checked={refuter.value === undefined}
                            onClick={() => {
                                refuter.value = undefined;
                            }}
                        />
                        <i>No refuter</i>
                    </label>
                </fieldset>

                <fieldset>
                    <legend>Seen refute card</legend>

                    {cards.value.length > 0 && (<>
                        {cards.value.sort().map(card => (
                            <label className={styles.toggleInput}>
                                <input
                                    type="radio"
                                    name="seenRefuteCard"
                                    value={card}
                                    checked={seenRefuteCard.value === card}
                                    onClick={() => {
                                        seenRefuteCard.value = card;
                                    }}
                                />
                                {idsToLabels.value[card[1]]}
                            </label>
                        ))}

                        <label className={styles.toggleInput}>
                            <input
                                type="radio"
                                name="seenRefuteCard"
                                value={undefined}
                                checked={seenRefuteCard.value === undefined}
                                onClick={() => {
                                    seenRefuteCard.value = undefined;
                                }}
                            />
                            <i>No refute card</i>
                        </label>
                    </>)}

                    {cards.value.length <= 0 && (
                        <i>No guessed cards selected</i>
                    )}
                </fieldset>
            </fieldset>

            <button type="submit">Create</button>
        </form>
    );
}
