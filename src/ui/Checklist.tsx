import { ReadonlySignal } from "@preact/signals";
import { Card, Player } from "../logic";

export function Checklist({
    players,
    cards,
}: {
    players: ReadonlySignal<Player[]>;
    cards: ReadonlySignal<Card[]>;
}) {
    return (<>
        <div>
            <h2>Checklist</h2>

            <table>
                <thead>
                    <tr>
                        <th>Case file</th>
                        <th>{/* Column for card names */}</th>
                        {players.value.map(player =>(
                            <th>{player}</th>
                        ))}
                    </tr>
                </thead>

                <tbody>
                    {cards.value
                        .sort()
                        .map(card => (
                        <tr>
                            <td>cf</td>
                            <td>{card}</td>
                            
                            {players.value.map(player => (
                                <td>{player}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </>);
}
