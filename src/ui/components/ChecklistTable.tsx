import * as Api from '../../api';

import './ChecklistTable.module.css';

export default function ChecklistTable({
    caseFile,
    players,
    cards,

    playerNumCards = {},
    onChangePlayerNumCards = () => undefined,

    onChangeOwnership = () => undefined,
    apiOutput,
}: {
    caseFile: string;
    players: string[],
    cards: [string, string][];

    playerNumCards?: { [player: string]: number };
    onChangePlayerNumCards?: (player: string, numCards: number) => void;

    onChangeOwnership: (player: string, card: [string, string], isOwned?: boolean) => void;
    apiOutput?: Api.ApiOutput;
}) {
    return (
        <table class="table">
            <thead>
                <tr>
                    {/* Blank heading for the cards row */}
                    <th/>

                    {/* Case file name column */}
                    <th>
                        <h3>{caseFile}</h3>
                    </th>

                    {/* Card owner name column headings */}
                    {players.map((name) => <th>
                        <h3>{name}</h3>
                        <input type="number" value={playerNumCards[name]} onInput={evt => onChangePlayerNumCards(name, parseInt(evt.target?.value))} />
                        <label>{playerNumCards[name]} cards</label>
                    </th>)}
                </tr>
            </thead>

            {cards.map(([cardType, cardName]) => (
                <tr>
                    <th>
                        <h3>{cardName}</h3>
                        <label>{cardType}</label>
                    </th>

                    <td class="border-cell">
                        <label>
                            <p>{String(apiOutput?.ownership('caseFile', caseFile, [cardType, cardName])?.isOwned)}</p>
                            <p>{String(apiOutput?.ownership('caseFile', caseFile, [cardType, cardName])?.reasons.join(', '))}</p>
                        </label>
                    </td>

                    {players.map((playerName) => (<td class="border-cell">
                        <select onInput={evt => {
                            const isOwned = (() => {
                                switch (evt.target?.value) {
                                    case 'unknown': return undefined;
                                    case 'owned': return true;
                                    case 'not-owned': return false;
                                }
                            })();

                            onChangeOwnership(playerName, [cardType, cardName], isOwned);
                        }}>
                            <option default value="unknown">Unknown</option>
                            <option value="owned">Owned</option>
                            <option value="not-owned">Not owned</option>
                        </select>

                        <label>
                            <p>{String(apiOutput?.ownership('player', playerName, [cardType, cardName])?.isOwned)}</p>
                            <p>{String(apiOutput?.ownership('player', playerName, [cardType, cardName])?.reasons.join(', '))}</p>
                        </label>
                    </td>))}
                </tr>
            ))}
        </table>
    );
}
