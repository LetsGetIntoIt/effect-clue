import './Clue.module.css';
import { useComputed, useSignal } from '@preact/signals';
import { newIdGenerator } from './utils/IdGenerator';
import { GameObjects } from './GameObjects';
import { Checklist } from './Checklist';
import { Suggestions } from './Suggestions';
import { Card, KnownCaseFileOwnership, KnownPlayerHandSize, KnownPlayerOwnership, Player, deduce } from '../logic';
import { useMemo } from 'preact/hooks';

export function Clue() {
    const idGenerator = useMemo(() => newIdGenerator(), []);
    const idsToLabels = useSignal<Record<string, string>>({});

    const players = useSignal<Player[]>([]);
    const cards = useSignal<Card[]>([]);

    const knownCaseFileOwnerships = useSignal<KnownCaseFileOwnership[]>([]);
    const knownPlayerOwnerships = useSignal<KnownPlayerOwnership[]>([]);
    const knownPlayerHandSizes = useSignal<KnownPlayerHandSize[]>([]);

    const deducedKnowledge = useComputed(() =>
        deduce({
            players: players.value,
            cards: cards.value,
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
                    players={players}
                    cards={cards}
                />
            </aside>

            <main class="checklist">
                <Checklist
                    idsToLabels={idsToLabels}
                    players={players}
                    cards={cards}
                    deducedKnowledge={deducedKnowledge}
                />
            </main>

            <aside class="suggestions">
                <Suggestions />
            </aside>

        </div>
    );
}
