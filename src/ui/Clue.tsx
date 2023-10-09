import './Clue.module.css';
import { useComputed, useSignal } from '@preact/signals';
import { newIdGenerator } from './utils/IdGenerator';
import { GameObjects } from './GameObjects';
import { Checklist } from './Checklist';
import { Suggestions } from './Suggestions';
import { Card, KnownCaseFileOwnership, KnownPlayerHandSize, KnownPlayerOwnership, Player, Suggestion, deduce, predict } from '../logic';
import { useMemo } from 'preact/hooks';
import { Either } from 'effect';
import { cardsByCategory as groupCardsByCategory } from './utils/cardsByCategory';

export function Clue() {
    const idGenerator = useMemo(() => newIdGenerator(), []);
    const idsToLabels = useSignal<Record<string, string>>({});
    const labelsToIds = useSignal<Record<string, string>>({});

    const players = useSignal<Player[]>([]);
    const cards = useSignal<Card[]>([]);
    const cardsByCategory = useComputed(() => groupCardsByCategory(cards.value))
    const suggestions = useSignal<Suggestion[]>([]);

    const knownCaseFileOwnerships = useSignal<KnownCaseFileOwnership>({});
    const knownPlayerOwnerships = useSignal<KnownPlayerOwnership>({});
    const knownPlayerHandSizes = useSignal<KnownPlayerHandSize>({});

    const deducedKnowledge = useComputed(() =>
        deduce({
            players: players.value,
            cards: cards.value,
            suggestions: suggestions.value,
            knownCaseFileOwnerships: knownCaseFileOwnerships.value,
            knownPlayerOwnerships: knownPlayerOwnerships.value,
            knownPlayerHandSizes: knownPlayerHandSizes.value,
        }).pipe(
            Either.mapLeft(paradox => ({
                paradox,
                fallbackKnowledge: ({
                    knownCaseFileOwnerships: knownCaseFileOwnerships.value,
                    knownPlayerOwnerships: knownPlayerOwnerships.value,
                    knownPlayerHandSizes: knownPlayerHandSizes.value,
                }),
            })),
        ),
    );

    const predictedKnowledge = useComputed(() =>
        predict({
            players: players.value,
            cards: cards.value,
            suggestions: suggestions.value,
            knownCaseFileOwnerships: knownCaseFileOwnerships.value,
            knownPlayerOwnerships: knownPlayerOwnerships.value,
            knownPlayerHandSizes: knownPlayerHandSizes.value,
        }),
    );

    return (
        <div class="clue">
            <aside class="gameObjects">
                <GameObjects
                    idGenerator={idGenerator}
                    idsToLabels={idsToLabels}
                    labelsToIds={labelsToIds}
                    players={players}
                    cards={cards}
                    cardsByCategory={cardsByCategory}
                />
            </aside>

            <main class="checklist">
                <Checklist
                    idsToLabels={idsToLabels}
                    players={players}
                    cardsByCategory={cardsByCategory}
                    knownCaseFileOwnerships={knownCaseFileOwnerships}
                    knownPlayerOwnerships={knownPlayerOwnerships}
                    knownPlayerHandSizes={knownPlayerHandSizes}
                    deducedKnowledge={deducedKnowledge}
                    predictedKnowledge={predictedKnowledge}
                />
            </main>

            <aside class="suggestions">
                <Suggestions
                    idsToLabels={idsToLabels}
                    players={players}
                    cardsByCategory={cardsByCategory}
                    suggestions={suggestions}
                />
            </aside>
        </div>
    );
}
