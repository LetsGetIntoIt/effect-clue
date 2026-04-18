import {
    Card,
    Owner,
    ownerLabel,
} from "../../logic/GameObjects";
import { allOwners } from "../../logic/GameSetup";
import {
    CellValue,
    getCellByOwnerCard,
    Knowledge,
    N,
    Y,
} from "../../logic/Knowledge";
import { explainCell } from "../../logic/Provenance";
import {
    caseFileAnswerFor,
    caseFileCandidatesFor,
    caseFileProgress,
} from "../../logic/Recommender";
import {
    deductionResultSignal,
    provenanceSignal,
    setupSignal,
} from "../state";

/**
 * The main visual: a header strip showing case-file progress on top, and
 * underneath a grid with one row per card and one column per owner
 * (players + case file). Cells show Y / N / blank and are coloured by
 * status. If explanations are enabled, hovering a cell shows the rule
 * that filled it in.
 *
 * The case-file header was previously a separate panel — folding it in
 * here puts the most-actionable summary right next to the grid that
 * justifies it.
 */
export function ChecklistGrid() {
    const setup = setupSignal.value;
    const result = deductionResultSignal.value;
    const provenance = provenanceSignal.value;

    const categories: ReadonlyArray<{ name: string; cards: ReadonlyArray<Card> }> =
        setup.categories.map(c => ({ name: String(c.name), cards: c.cards }));

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
            <CaseFileHeader knowledge={knowledge} />
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
                                                ? `${reason.kind.kind} @ iter ${reason.iteration}\n${reason.detail}`
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

function CaseFileHeader({ knowledge }: { knowledge: Knowledge }) {
    const setup = setupSignal.value;
    const progress = caseFileProgress(setup, knowledge);
    return (
        <div class="case-file-header">
            <div class="case-file-progress">
                <span class="case-file-progress-label">
                    Case file · {(progress * 100).toFixed(0)}% solved
                </span>
                <div class="progress-bar">
                    <div style={{ width: `${progress * 100}%` }} />
                </div>
            </div>
            <div class="case-file-slots">
                {setup.categories.map(category => {
                    const solved = caseFileAnswerFor(setup, knowledge, category.name);
                    const candidates = caseFileCandidatesFor(
                        setup, knowledge, category.name);
                    return (
                        <div class="case-file-slot" key={String(category.name)}>
                            <div class="case-file-slot-label">
                                {String(category.name)}
                            </div>
                            {solved ? (
                                <div class="case-file-slot-answer">{solved}</div>
                            ) : (
                                <div class="case-file-slot-candidates muted">
                                    {candidates.length} candidate
                                    {candidates.length === 1 ? "" : "s"}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
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
