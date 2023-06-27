import './ChecklistTable.module.css';

export default function ChecklistTable({
    owners,
    cards,
}: {
    owners: string[],
    cards: [string, string][];
}) {
    return (
        <table class="table">
            <thead>
                <tr>
                    {/* Blank heading for the cards row */}
                    <th/>

                    {/* Card owner name column headings */}
                    {owners.map((name) => <th>
                        <h3>{name}</h3>
                        <label>_ cards</label>
                    </th>)}
                </tr>
            </thead>

            {cards.map(([cardType, cardName]) => (
                <tr>
                    <th>
                        <h3>{cardName}</h3>
                        <label>{cardType}</label>
                    </th>

                    {owners.map((name) => (<td class="border-cell">
                        'yes/no'
                    </td>))}
                </tr>
            ))}
        </table>
    );
}
