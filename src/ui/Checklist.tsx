// TODO these imports definitely need to be refactored out
import { Either } from "effect";
import { LogicalParadox } from "../logic/LogicalParadox";

import './Checklist.module.css';
import { ReadonlySignal } from "@preact/signals";
import { Knowledge } from "../logic";
import { SelectChecklistValue } from "./forms/SelectChecklistValue";

export function Checklist({
    idsToLabels,
    players,
    cards,
    deducedKnowledge,
}: {
    idsToLabels: ReadonlySignal<Record<string, string>>;
    players: ReadonlySignal<string[]>;
    cards: ReadonlySignal<[string, string][]>;
    deducedKnowledge: ReadonlySignal<Either.Either<LogicalParadox, Knowledge>>;
}) {
    return (<>
        <div>
            <h2>Checklist</h2>

            <table class="table">
                <thead>
                    <tr>
                        <th>Case file</th>
                        <th>{/* Column for card names */}</th>
                        {players.value.map(player =>(
                            <th>{idsToLabels.value[player]}</th>
                        ))}
                    </tr>
                </thead>

                <tbody>
                    {cards.value
                        .sort()
                        .map(([cardCategory, card]) => (
                        <tr>
                            <td>
                                <SelectChecklistValue
                                    name={`${cardCategory}-${card}-CF`} 
                                    onSelect={(value) => {
                                        debugger;
                                    }}
                                />
                            </td>

                            <td>{idsToLabels.value[card]}</td>

                            {players.value.map(player => (
                                <td>
                                    <SelectChecklistValue
                                        name={`P-${cardCategory}-${card}-P-${player}`} 
                                        onSelect={(value) => {
                                            debugger;
                                        }}
                                    />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>

            <h2>Knowledge</h2>
            <pre>{JSON.stringify(deducedKnowledge.value, null, 4)}</pre>
        </div>
    </>);
}
