import { useSignal } from "@preact/signals";
import { Player } from "../../logic";

export function CreatePlayerForm({
    onSubmit,
}: {
    onSubmit: (player: Player) => void;
}) {
    const playerName = useSignal<Player>('');

    return (
        <form
            class="container"
            onSubmit={(evt) => {
                // Submit the card with its IDs
                onSubmit(playerName.value);

                // Clear the inputs
                playerName.value = '';

                // Prevent the browser from reloading
                evt.preventDefault();
            }}
        >
            <input
                name="newPlayerName"
                type="text"
                placeholder="Player name"
                value={playerName.value}
                onInput={evt => {
                    playerName.value = evt.currentTarget.value;
                }}
            />

            <button type="submit">Create</button>
        </form>
    );
}
