import './Clue.module.css';
import { useSignal } from '@preact/signals';
import { newIdGenerator } from './utils/IdGenerator';
import { GameObjects } from './GameObjects';
import { Checklist } from './Checklist';
import { Suggestions } from './Suggestions';
import { Card, Player } from '../logic';

export function Clue() {
    const idGenerator = useSignal(newIdGenerator());
    const idsToLabels = useSignal<Record<string, string>>({});

    const players = useSignal<Player[]>([]);
    const cards = useSignal<Card[]>([]);

    return (
        <div class="clue">
            <aside class="gameObjects">
                <GameObjects
                    players={players}
                    cards={cards}
                />
            </aside>

            <main class="checklist">
                <Checklist
                    players={players}
                    cards={cards}
                />
            </main>

            <aside class="suggestions">
                <Suggestions />
            </aside>

        </div>
    );
}
