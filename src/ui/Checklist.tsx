// TODO these imports definitely need to be refactored out
import { Either, Match, ReadonlyRecord } from "effect";
import { LogicalParadox } from "../logic/LogicalParadox";

import styles from './Checklist.module.css';
import { ReadonlySignal, Signal, useSignal } from "@preact/signals";
import { Card, CardCategory, Knowledge, KnownCaseFileOwnership, KnownPlayerHandSize, KnownPlayerOwnership, Player, Prediction } from "../logic";
import { SelectChecklistValue } from "./forms/SelectChecklistValue";
import { ApiKnownCaseFileOwnershipKey, ApiKnownPlayerHandSizeKey, ApiKnownPlayerOwnershipKey } from "../logic/Api";
import { SelectHandSize } from "./forms/SelectHandSize";

export function Checklist({
    idsToLabels,
    players,
    cardsByCategory,
    knownCaseFileOwnerships,
    knownPlayerOwnerships,
    knownPlayerHandSizes,
    deducedKnowledge,
    predictedKnowledge,
}: {
    idsToLabels: ReadonlySignal<Record<string, string>>;
    players: ReadonlySignal<Player[]>;
    cardsByCategory: ReadonlySignal<Record<CardCategory, Card[]>>;
    knownCaseFileOwnerships: Signal<KnownCaseFileOwnership>;
    knownPlayerOwnerships: Signal<KnownPlayerOwnership>;
    knownPlayerHandSizes: Signal<KnownPlayerHandSize>;
    deducedKnowledge: ReadonlySignal<
        Either.Either<{ paradox: LogicalParadox; fallbackKnowledge: Knowledge }, Knowledge>
    >;
    predictedKnowledge: ReadonlySignal<Promise<Prediction>>;
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

            <table className={styles.table}>
                <thead>
                    <tr>
                        <th className={styles.headCell}>Case file</th>
                        <th className={styles.headCell}>{/* Column for card names */}</th>
                        {players.value.map(player =>(
                            <th className={styles.headCell}>
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
                    {ReadonlyRecord.toEntries(cardsByCategory.value)
                        .sort()
                        .map(([category, cardsInCategory]) => (<>
                            <tr>
                                <td>{/* blank cell in case file column */}</td>
                                <td className={styles.headCell}>
                                    <strong>{idsToLabels.value[category]}</strong>
                                </td>
                            </tr>

                            {cardsInCategory
                                .sort()
                                .map(card => (
                                <tr>
                                    <CaseFileCell
                                        card={card}
                                        knownCaseFileOwnerships={knownCaseFileOwnerships}
                                        deducedKnowledge={deducedKnowledge}
                                        predictedKnowledge={predictedKnowledge}
                                    />

                                    <td className={styles.headCell}>{idsToLabels.value[card[1]]}</td>

                                    {players.value.map(player => (
                                        <PlayerCell
                                            player={player}
                                            card={card}
                                            knownPlayerOwnerships={knownPlayerOwnerships}
                                            deducedKnowledge={deducedKnowledge}
                                            predictedKnowledge={predictedKnowledge}
                                        />
                                    ))}
                                </tr>
                            ))}
                        </>))
                    }
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
    predictedKnowledge,
}: {
    card: Card;
    knownCaseFileOwnerships: Signal<KnownCaseFileOwnership>;
    deducedKnowledge: ReadonlySignal<
        Either.Either<{ paradox: LogicalParadox; fallbackKnowledge: Knowledge }, Knowledge>
    >;
    predictedKnowledge: ReadonlySignal<Promise<Prediction>>;
}) {
    const key = ApiKnownCaseFileOwnershipKey(card);

    const value = Either.match(deducedKnowledge.value, {
        onLeft: ({ fallbackKnowledge }) => fallbackKnowledge.knownCaseFileOwnerships[key],
        onRight: (deducedKnowledge) => deducedKnowledge.knownCaseFileOwnerships[key]
    });

    const predictedValue = useSignal<number | undefined>(undefined);
    predictedKnowledge.value.then((predictedKnowledge) => {
        predictedValue.value = predictedKnowledge.predictedCaseFileOwnerships[key];
    });

    return (
        <td className={`${styles.dataCell} ${value ? styles[`cell${value}`] : ''}`}>
            <SelectChecklistValue
                formElementClassName={styles.toggleInput}
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

            <div>
                {predictedValue.value === undefined
                    ? (<i>Predicting...</i>)
                    : (<span>{predictedValue.value.toFixed(1)}%</span>)
                }
            </div>
        </td>
    );
}

function PlayerCell({
    player,
    card,
    knownPlayerOwnerships,
    deducedKnowledge,
    predictedKnowledge,
}: {
    player: Player;
    card: Card;
    knownPlayerOwnerships: Signal<KnownPlayerOwnership>;
    deducedKnowledge: ReadonlySignal<
        Either.Either<{ paradox: LogicalParadox; fallbackKnowledge: Knowledge }, Knowledge>
    >;
    predictedKnowledge: ReadonlySignal<Promise<Prediction>>;
}) {
    const key = ApiKnownPlayerOwnershipKey(player, card);

    const value = Either.match(deducedKnowledge.value, {
        onLeft: ({ fallbackKnowledge }) => fallbackKnowledge.knownPlayerOwnerships[key],
        onRight: (deducedKnowledge) => deducedKnowledge.knownPlayerOwnerships[key]
    });

    const predictedValue = useSignal<number | undefined>(undefined);
    predictedKnowledge.value.then((predictedKnowledge) => {
        predictedValue.value = predictedKnowledge.predictedPlayerOwnerships[key];
    });

    return (
        <td className={`${styles.dataCell} ${value ? styles[`cell${value}`] : ''}`}>
            <SelectChecklistValue
                formElementClassName={styles.toggleInput}
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

            <div>
                {predictedValue.value === undefined
                    ? (<i>Predicting...</i>)
                    : (<span>{predictedValue.value.toFixed(1)}%</span>)
                }
            </div>
        </td>
    );
}
