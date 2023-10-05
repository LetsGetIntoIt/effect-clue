import { useSignal } from "@preact/signals";
import { Card, CardCategory, CardName } from "../../logic";

export function CreateCardForm({
    onSubmit,
}: {
    onSubmit: (card: Card) => void;
}) {
    const cardCategoryName = useSignal<CardCategory>('');
    const cardName = useSignal<CardName>('');

    return (
        <form
            onSubmit={(evt) => {
                // Submit the card name
                onSubmit([cardCategoryName.value, cardName.value]);

                // Clear the inputs
                cardCategoryName.value = '';
                cardName.value = '';

                // Prevent the browser from reloading
                evt.preventDefault();
            }}
        >
            <input
                name="newCardCategory"
                type="text"
                placeholder="Category name"
                value={cardCategoryName.value}
                onInput={evt => {
                    cardCategoryName.value = evt.currentTarget.value;
                }}
            />

            <input
                name="newCardName"
                type="text"
                placeholder="Card name"
                value={cardName.value}
                onInput={evt => {
                    cardName.value = evt.currentTarget.value;
                }}
            />

            <button type="submit">Create</button>
        </form>
    );
}
