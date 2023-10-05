import { Signal } from "@preact/signals"
import { Card, Player } from "../logic";

export function GameObjects({
    players,
    cards,
}: {
    players: Signal<Player[]>;
    cards: Signal<Card[]>;
}) {
    return (<>
        <div>
            <h2>Players</h2>
            {players.value.map(player => (
                <div>{player}</div>
            ))}
            <input type="text" onBlur={(evt) => {
                const value: string = (evt as any).target.value;
                players.value = [...players.value, value];
            }} />
        </div>

        <div>
            <h2>Cards</h2>
            {cards.value
                .sort()
                .map(([cardCategory, cardName]) => (
                    <div>{cardCategory}: {cardName}</div>
                )
            )}
            <input type="text" onBlur={(evt) => {
                const value: string = (evt as any).target.value;
                const [cardCategory, cardName] = value.split(":");
                cards.value = [...cards.value, [cardCategory, cardName]];
            }} />
        </div>
    </>)
}
