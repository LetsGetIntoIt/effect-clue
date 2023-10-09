import { ReadonlySignal, Signal } from "@preact/signals"
import { Card, CardCategory, Player } from "../logic";
import { CreatePlayerForm } from "./forms/CreatePlayerForm";
import { CreateCardForm } from "./forms/CreateCardForm";
import { IdGenerator } from "./utils/IdGenerator";
import { useMemo } from "preact/hooks";

export function GameObjects({
    idGenerator,
    idsToLabels,
    labelsToIds,
    players,
    cards,
    cardsByCategory,
}: {
    idGenerator: IdGenerator<string>;
    idsToLabels: Signal<Record<string, string>>;
    labelsToIds: Signal<Record<string, string>>;
    players: Signal<Player[]>;
    cards: Signal<Card[]>;
    cardsByCategory: ReadonlySignal<Record<CardCategory, Card[]>>;
}) {
    const getOrGenerateId = (label: string) => {
        const existingId = labelsToIds.value[label];
        if (existingId) {
            return existingId;
        }

        const newId = idGenerator.next();
        idsToLabels.value = {
            ...idsToLabels.value,
            [newId]: label,
        };
        labelsToIds.value = {
            ...labelsToIds.value,
            [label]: newId,
        }

        return newId;
    }
    
    const createPlayer = useMemo(() => (playerName: string): void => {
        const playerId = getOrGenerateId(playerName);
        players.value = [...players.value, playerId];
    }, []);

    const createCard = useMemo(() => ([cardCategoryName, cardName]: [string, string]): void => {
        const cardCategoryId = getOrGenerateId(cardCategoryName);
        const cardId = getOrGenerateId(cardName);
        cards.value = [...cards.value, [cardCategoryId, cardId]];
    }, []);

    return (<>
        <div>
            <h2>Players</h2>
            {players.value.map(player => (
                <div>{idsToLabels.value[player]}</div>
            ))}

            <CreatePlayerForm
                onSubmit={createPlayer}
            />

            <button onClick={() => {
                createPlayer("Anisha");
                createPlayer("Bob");
                createPlayer("Cho");
            }}>
                Add standards
            </button>
        </div>

        <div>
            <h2>Cards</h2>
            {cards.value
                .sort()
                .map(([cardCategory, cardName]) => (
                    <div>{idsToLabels.value[cardCategory]}: {idsToLabels.value[cardName]}</div>
                )
            )}

            <CreateCardForm
                idsToLabels={idsToLabels}
                existingCardsByCategory={cardsByCategory}
                onSubmit={createCard}
            />

            <button onClick={() => {
                createCard(["Suspect", "Miss Scarlet"]);
                createCard(["Suspect", "Col. Mustard"]);
                createCard(["Suspect", "Mrs. White"]);
                createCard(["Suspect", "Mr. Green"]);
                createCard(["Suspect", "Mrs. Peacock"]);
                createCard(["Suspect", "Prof. Plum"]);
                createCard(["Weapon", "Candlestick"]);
                createCard(["Weapon", "Knife"]);
                createCard(["Weapon", "Lead pipe"]);
                createCard(["Weapon", "Revolver"]);
                createCard(["Weapon", "Rope"]);
                createCard(["Weapon", "Wrench"]);
                createCard(["Room", "Kitchen"]);
                createCard(["Room", "Ball room"]);
                createCard(["Room", "Conservatory"]);
                createCard(["Room", "Dining room"]);
                createCard(["Room", "Billiard room"]);
                createCard(["Room", "Library"]);
                createCard(["Room", "Lounge"]);
                createCard(["Room", "Hall"]);
                createCard(["Room", "Study"]);
            }}>
                Add standards
            </button>
        </div>
    </>)
}
