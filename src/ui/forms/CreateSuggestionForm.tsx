import './CreateSuggestionForm.module.css';
import { ReadonlySignal, useSignal } from "@preact/signals";
import { Card, Player, Suggestion } from "../../logic";

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
                    <label>
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
                {allCards.value.map(card => (
                    <label>
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
            </fieldset>

            <fieldset>
                <legend>Non-refuters</legend>
                {allPlayers.value.map(player => (
                    <label>
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
                        <label>
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

                    <label>
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
                        {cards.value.map(card => (
                            <label>
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

                        <label>
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