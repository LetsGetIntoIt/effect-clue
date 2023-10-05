import { useSignal } from "@preact/signals";

export function SelectHandSize({
    value,
    onSelect,
}: {
    value: number | undefined;
    onSelect: (value: number | undefined) => void;
}) {
    return (
        <form onSubmit={(evt) => {
                // Prevent the browser from reloading
                evt.preventDefault();
        }}>
            <input
                type="number"
                value={value}
                onInput={(evt) => {
                    onSelect(parseInt(evt.currentTarget.value));
                }}
            />
        </form>
    );
}
