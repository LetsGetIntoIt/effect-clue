import { useId } from "preact/hooks";
import { ChecklistValue } from "../../logic"

export function SelectChecklistValue({
    name,
    value,
    onSelect,
}: {
    name: string;
    value: ChecklistValue | undefined;
    onSelect: (value: ChecklistValue | undefined) => void;
}) {
    const yId = useId();
    const nId = useId();
    const unknownId = useId();

    return (
        <form onSubmit={(evt) => {
            // Stop the browser from reloading
            evt.preventDefault();
        }}>
            <label for={yId}>
                <input
                    id={yId}
                    type="radio"
                    name={name}
                    value="Y"
                    checked={value === "Y"}
                    onClick={() => onSelect("Y")}
                />
                Y
            </label>

            <label for={nId}>
                <input
                    id={nId}
                    type="radio"
                    name={name}
                    value="N"
                    checked={value === "N"}
                    onClick={() => onSelect("N")}
                />
                N
            </label>

            <label for={unknownId}>
                <input
                    id={unknownId}
                    type="radio"
                    name={name}
                    value={undefined}
                    checked={value === undefined}
                    onClick={() => onSelect(undefined)}
                />
                ?
            </label>
        </form>
    );
}
