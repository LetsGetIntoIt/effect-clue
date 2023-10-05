import { useId } from "preact/hooks";
import { ChecklistValue } from "../../logic"

export function SelectChecklistValue({
    name,
    onSelect,
}: {
    name: string;
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
                <input id={yId} type="radio" name={name} value="Y" onClick={() => onSelect("Y")} />
                Y
            </label>

            <label for={nId}>
                <input id={nId} type="radio" name={name} value="N" onClick={() => onSelect("N")} />
                N
            </label>

            <label for={unknownId}>
                <input id={unknownId} type="radio" name={name} value="?" onClick={() => onSelect(undefined)} />
                ?
            </label>
        </form>
    );
}
