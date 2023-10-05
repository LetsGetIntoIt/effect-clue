import { ReadonlySignal } from "@preact/signals";

export function Checklist({
    players,
    cards,
}: {
    players: ReadonlySignal<string[]>;
    cards: ReadonlySignal<[string, string][]>;
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
                        .map(([cardCategory, cardName]) => (
                        <tr>
                            <td>cf</td>
                            <td>{cardName}</td>
                            
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
