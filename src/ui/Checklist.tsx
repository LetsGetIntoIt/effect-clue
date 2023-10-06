// TODO these imports definitely need to be refactored out
import { Either, Match } from "effect";
import { LogicalParadox } from "../logic/LogicalParadox";

import styles from './Checklist.module.css';
import { ReadonlySignal, Signal } from "@preact/signals";
import { Card, Knowledge, KnownCaseFileOwnership, KnownPlayerHandSize, KnownPlayerOwnership, Player } from "../logic";
import { SelectChecklistValue } from "./forms/SelectChecklistValue";
import { ApiKnownCaseFileOwnershipKey, ApiKnownPlayerHandSizeKey, ApiKnownPlayerOwnershipKey } from "../logic/Api";
import { SelectHandSize } from "./forms/SelectHandSize";

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
    players: ReadonlySignal<Player[]>;
    cards: ReadonlySignal<Card[]>;
    knownCaseFileOwnerships: Signal<KnownCaseFileOwnership>;
    knownPlayerOwnerships: Signal<KnownPlayerOwnership>;
    knownPlayerHandSizes: Signal<KnownPlayerHandSize>;
    deducedKnowledge: ReadonlySignal<
        Either.Either<{ paradox: LogicalParadox; fallbackKnowledge: Knowledge }, Knowledge>
    >;
}) {
    return (<>
        <div>
            <h2>Checklist</h2>

            {Either.match(
                Either.mapLeft(deducedKnowledge.value, ({ paradox }) => paradox),
                {
                    onLeft: Match.type<LogicalParadox>().pipe(
                        Match.tagsExhaustive({
                            PlayerChecklistValueConflictYN: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            PlayerChecklistValueConflictNY: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            CaseFileChecklistValueConflictYN: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            CaseFileChecklistValueConflictNY: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            PlayerHandSizeValueConflict: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            PlayerHandSizeNegative: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            PlayerHandSizeTooBig: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            CardHasTooManyOwners: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            CardHasTooFewOwners: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            PlayerHasTooManyCards: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            PlayerHasTooFewCards: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            CaseFileHasTooManyCards: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                            CaseFileHasTooFewCards: (err) => (
                                <pre>{JSON.stringify(err)}</pre>
                            ),

                        }),
                    ),

                    onRight: () => (
                        <pre>Everything checks out!</pre>
                    ),
                }
            )}

            <table class={styles.table}>
                <thead>
                    <tr>
                        <th>Case file</th>
                        <th>{/* Column for card names */}</th>
                        {players.value.map(player =>(
                            <th>
                                {idsToLabels.value[player]}
                                <HandSizeSelect
                                    player={player}
                                    knownPlayerHandSizes={knownPlayerHandSizes}
                                    deducedKnowledge={deducedKnowledge}
                                />
                            </th>
                        ))}
                    </tr>
                </thead>

                <tbody>
                    {cards.value
                        .sort()
                        .map(card => (
                        <tr>
                            <CaseFileCell
                                card={card}
                                knownCaseFileOwnerships={knownCaseFileOwnerships}
                                deducedKnowledge={deducedKnowledge}
                            />

                            <td>{idsToLabels.value[card[1]]}</td>

                            {players.value.map(player => (
                                <PlayerCell
                                    player={player}
                                    card={card}
                                    knownPlayerOwnerships={knownPlayerOwnerships}
                                    deducedKnowledge={deducedKnowledge}
                                />
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </>);
}

function HandSizeSelect({
    player,
    knownPlayerHandSizes,
    deducedKnowledge,
}: {
    player: Player;
    knownPlayerHandSizes: Signal<KnownPlayerHandSize>;
    deducedKnowledge: ReadonlySignal<
        Either.Either<{ paradox: LogicalParadox; fallbackKnowledge: Knowledge }, Knowledge>
    >;
}) {
    const key = ApiKnownPlayerHandSizeKey(player);
    const value = Either.match(deducedKnowledge.value, {
        onLeft: ({ fallbackKnowledge }) => fallbackKnowledge.knownPlayerHandSizes[key],
        onRight: (deducedKnowledge) => deducedKnowledge.knownPlayerHandSizes[key]
    });

    return (
        <SelectHandSize
            value={value}
            onSelect={(value) => {
                // Get the current knowledge without this key
                const { [key]: _, ...restKnownPlayerHandSizes}  = knownPlayerHandSizes.value;

                // Set or delete the value
                if (value) {
                    knownPlayerHandSizes.value = {
                        ...restKnownPlayerHandSizes,
                        [key]: value,
                    }
                } else {
                    knownPlayerHandSizes.value = restKnownPlayerHandSizes;
                }
            }}
        />
    );
}

function CaseFileCell({
    card,
    knownCaseFileOwnerships,
    deducedKnowledge,
}: {
    card: Card;
    knownCaseFileOwnerships: Signal<KnownCaseFileOwnership>;
    deducedKnowledge: ReadonlySignal<
        Either.Either<{ paradox: LogicalParadox; fallbackKnowledge: Knowledge }, Knowledge>
    >;
}) {
    const key = ApiKnownCaseFileOwnershipKey(card);
    const value = Either.match(deducedKnowledge.value, {
        onLeft: ({ fallbackKnowledge }) => fallbackKnowledge.knownCaseFileOwnerships[key],
        onRight: (deducedKnowledge) => deducedKnowledge.knownCaseFileOwnerships[key]
    });

    return (
        <td className={value ? `cell-${value}` : undefined}>
            <SelectChecklistValue
                name={key}
                value={value}
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
        </td>
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
    deducedKnowledge: ReadonlySignal<
        Either.Either<{ paradox: LogicalParadox; fallbackKnowledge: Knowledge }, Knowledge>
    >;
}) {
    const key = ApiKnownPlayerOwnershipKey(player, card);
    const value = Either.match(deducedKnowledge.value, {
        onLeft: ({ fallbackKnowledge }) => fallbackKnowledge.knownPlayerOwnerships[key],
        onRight: (deducedKnowledge) => deducedKnowledge.knownPlayerOwnerships[key]
    });

    return (
        <td className={value ? `cell-${value}` : undefined}>
            <SelectChecklistValue
                name={key}
                value={value}
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
        </td>
    );
}
