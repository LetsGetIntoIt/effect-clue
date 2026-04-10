import {
    Card,
    Owner,
    ownerLabel,
} from "../../logic/GameObjects";
import { allOwners, GameSetup } from "../../logic/GameSetup";
import {
    CellValue,
    getCellByOwnerCard,
    Knowledge,
    N,
    Y,
} from "../../logic/Knowledge";
import { explainCell } from "../../logic/Provenance";
import {
    deductionResultSignal,
    provenanceSignal,
    setupSignal,
} from "../state";

/**
 * The main visual: a grid with one row per card and one column per owner
 * (players + case file). Cells show Y / N / blank and are coloured by
 * status. If explanations are enabled, hovering a cell displays the rule
 * that filled it in.
 *
 * We put cards on the rows (rather than the columns) because there are
 * typically many more cards than players and this makes the table scroll
 * vertically rather than horizontally.
 */
export function ChecklistGrid() {
    const setup = setupSignal.value;
    const result = deductionResultSignal.value;
    const provenance = provenanceSignal.value;

    const categories: ReadonlyArray<{ name: string; cards: ReadonlyArray<Card> }> = [
        { name: "Suspects", cards: setup.suspects },
        { name: "Weapons",  cards: setup.weapons },
        { name: "Rooms",    cards: setup.rooms },
    ];

    const owners: ReadonlyArray<Owner> = allOwners(setup);

    if (result._tag === "Contradiction") {
        return (
            <section class="panel">
                <h2>Deduction grid</h2>
                <div class="contradiction">
                    <strong>Contradiction:</strong> {result.error.reason}
                </div>
            </section>
        );
    }

    const knowledge: Knowledge = result.knowledge;

    return (
        <section class="panel">
            <h2>Deduction grid</h2>
            <table class="checklist-grid">
                <thead>
                    <tr>
                        <th></th>
                        {owners.map(owner => (
                            <th key={ownerKey(owner)}>{ownerLabel(owner)}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {categories.flatMap(category => [
                        <tr class="category-row" key={`h-${category.name}`}>
                            <th colSpan={1 + owners.length}>{category.name}</th>
                        </tr>,
                        ...category.cards.map(card => (
                            <tr key={card}>
                                <th class="card-name">{card}</th>
                                {owners.map(owner => {
                                    const value = getCellByOwnerCard(
                                        knowledge,
                                        owner,
                                        card,
                                    );
                                    const reason = provenance
                                        ? explainCell(provenance, owner, card)
                                        : undefined;
                                    return (
                                        <td
                                            key={`${ownerKey(owner)}-${card}`}
                                            class={cellClass(value)}
                                            title={reason
                                                ? `${reason.rule} @ iter ${reason.iteration}\n${reason.detail}`
                                                : undefined}
                                        >
                                            {cellLabel(value)}
                                        </td>
                                    );
                                })}
                            </tr>
                        )),
                    ])}
                </tbody>
            </table>
        </section>
    );
}

const ownerKey = (owner: Owner): string =>
    owner._tag === "Player" ? `p-${owner.player}` : "case-file";

const cellLabel = (value: CellValue | undefined): string => {
    if (value === Y) return "✓";
    if (value === N) return "·";
    return "";
};

const cellClass = (value: CellValue | undefined): string => {
    if (value === Y) return "cell cell-yes";
    if (value === N) return "cell cell-no";
    return "cell cell-unknown";
};

