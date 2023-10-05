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
    return (
        <form onSubmit={(evt) => {
            // Stop the browser from reloading
            evt.preventDefault();
        }}>
            <label>
                <input
                    type="radio"
                    name={name}
                    value="Y"
                    checked={value === "Y"}
                    onClick={() => onSelect("Y")}
                />
                Y
            </label>

            <label>
                <input
                    type="radio"
                    name={name}
                    value="N"
                    checked={value === "N"}
                    onClick={() => onSelect("N")}
                />
                N
            </label>

            <label>
                <input
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
