// TODO these imports definitely need to be refactored out
import { Either } from "effect";
import { LogicalParadox } from "../logic/LogicalParadox";

import './Checklist.module.css';
import { ReadonlySignal, Signal } from "@preact/signals";
import { Card, Knowledge, KnownCaseFileOwnership, KnownPlayerHandSize, KnownPlayerOwnership, Player } from "../logic";
import { SelectChecklistValue } from "./forms/SelectChecklistValue";
import { ApiKnownCaseFileOwnershipKey, ApiKnownPlayerOwnershipKey } from "../logic/Api";

export function Checklist({
    idsToLabels,
    players,
    cards,
    knownCaseFileOwnerships,
    knownPlayerOwnerships,
    knownPlayerHandSizes,
    deducedKnowledge,
}: {
    idsToLabels: ReadonlySignal<Record<string, string>>;
    players: ReadonlySignal<string[]>;
    cards: ReadonlySignal<[string, string][]>;
    knownCaseFileOwnerships: Signal<KnownCaseFileOwnership>;
    knownPlayerOwnerships: Signal<KnownPlayerOwnership>;
    knownPlayerHandSizes: Signal<KnownPlayerHandSize>;
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
                        .map(card => (
                        <tr>
                            <td>
                                <CaseFileCell
                                    card={card}
                                    knownCaseFileOwnerships={knownCaseFileOwnerships}
                                    deducedKnowledge={deducedKnowledge}
                                />
                            </td>

                            <td>{idsToLabels.value[card[1]]}</td>

                            {players.value.map(player => (
                                <td>
                                    <PlayerCell
                                        player={player}
                                        card={card}
                                        knownPlayerOwnerships={knownPlayerOwnerships}
                                        deducedKnowledge={deducedKnowledge}
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

function CaseFileCell({
    card,
    knownCaseFileOwnerships,
    deducedKnowledge,
}: {
    card: Card;
    knownCaseFileOwnerships: Signal<KnownCaseFileOwnership>;
    deducedKnowledge: ReadonlySignal<Either.Either<LogicalParadox, Knowledge>>;
}) {
    const key = ApiKnownCaseFileOwnershipKey(card);

    return (
        <SelectChecklistValue
            name={key}
            value={Either.match(deducedKnowledge.value, {
                onLeft: () => undefined,
                onRight: (deducedKnowledge) => deducedKnowledge.knownCaseFileOwnerships[key]
            })}
            onSelect={(value) => {
                // Get the current knowledge without this key
                const { [key]: _, ...restKnownCaseFileOwnerships}  = knownCaseFileOwnerships.value;

                // Set or delete the value
                if (value) {
                    knownCaseFileOwnerships.value = {
                        ...restKnownCaseFileOwnerships,
                        [key]: value,
                    }
                } else {
                    knownCaseFileOwnerships.value = restKnownCaseFileOwnerships;
                }
            }}
        />
    );
}

function PlayerCell({
    player,
    card,
    knownPlayerOwnerships,
    deducedKnowledge,
}: {
    player: Player;
    card: Card;
    knownPlayerOwnerships: Signal<KnownPlayerOwnership>;
    deducedKnowledge: ReadonlySignal<Either.Either<LogicalParadox, Knowledge>>;
}) {
    const key = ApiKnownPlayerOwnershipKey(player, card);

    return (
        <SelectChecklistValue
            name={key}
            value={Either.match(deducedKnowledge.value, {
                onLeft: () => undefined,
                onRight: (deducedKnowledge) => deducedKnowledge.knownPlayerOwnerships[key]
            })}
            onSelect={(value) => {
                // Get the current knowledge without this key
                const { [key]: _, ...restKnownPlayerOwnerships}  = knownPlayerOwnerships.value;

                // Set or delete the value
                if (value) {
                    knownPlayerOwnerships.value = {
                        ...restKnownPlayerOwnerships,
                        [key]: value,
                    }
                } else {
                    knownPlayerOwnerships.value = restKnownPlayerOwnerships;
                }
            }}
        />
    );
}
