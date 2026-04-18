"use client";

import { Card, Owner, ownerLabel } from "../../logic/GameObjects";
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
import { useClue } from "../state";

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
    const { state, derived } = useClue();
    const setup = state.setup;
    const result = derived.deductionResult;
    const provenance = derived.provenance;

    const categories: ReadonlyArray<{
        name: string;
        cards: ReadonlyArray<Card>;
    }> = setup.categories.map(c => ({
        name: String(c.name),
        cards: c.cards,
    }));

    const owners: ReadonlyArray<Owner> = allOwners(setup);

    if (result._tag === "Contradiction") {
        return (
            <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
                <h2 className="mb-3 text-[16px] uppercase tracking-[0.05em] text-accent">
                    Deduction grid
                </h2>
                <div className="rounded-[var(--radius)] border border-danger-border bg-danger-bg p-3 text-[13px] text-danger">
                    <strong>Contradiction:</strong> {result.error.reason}
                </div>
            </section>
        );
    }

    const knowledge: Knowledge = result.knowledge;

    return (
        <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
            <h2 className="mb-3 text-[16px] uppercase tracking-[0.05em] text-accent">
                Deduction grid
            </h2>
            <CaseFileHeader knowledge={knowledge} />
            <table className="w-full border-collapse text-[13px]">
                <thead>
                    <tr>
                        <th className="sticky top-0 border border-border bg-row-header px-2 py-1 text-center font-semibold"></th>
                        {owners.map(owner => (
                            <th
                                key={ownerKey(owner)}
                                className="sticky top-0 border border-border bg-row-header px-2 py-1 text-center font-semibold"
                            >
                                {ownerLabel(owner)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {categories.flatMap(category => [
                        <tr key={`h-${category.name}`}>
                            <th
                                colSpan={1 + owners.length}
                                className="border border-border bg-accent px-2 py-1.5 text-left text-[11px] uppercase tracking-[0.05em] text-white"
                            >
                                {category.name}
                            </th>
                        </tr>,
                        ...category.cards.map(card => (
                            <tr key={card}>
                                <th className="border border-border px-2 py-1 text-left font-normal">
                                    {card}
                                </th>
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
                                            className={cellClass(value)}
                                            title={
                                                reason
                                                    ? `${reason.kind.kind} @ iter ${reason.iteration}\n${reason.detail}`
                                                    : undefined
                                            }
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
    const { state } = useClue();
    const setup = state.setup;
    const progress = caseFileProgress(setup, knowledge);
    return (
        <div className="mb-4 rounded-[var(--radius)] border border-border bg-case-file-bg p-3">
            <div className="mb-2.5 flex items-center gap-3 text-[13px]">
                <span className="whitespace-nowrap font-semibold text-accent">
                    Case file · {(progress * 100).toFixed(0)}% solved
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-border">
                    <div
                        className="h-full bg-accent transition-[width] duration-200"
                        style={{ width: `${progress * 100}%` }}
                    />
                </div>
            </div>
            <div
                className="grid gap-2"
                style={{
                    gridTemplateColumns: `repeat(${setup.categories.length || 1}, minmax(0, 1fr))`,
                }}
            >
                {setup.categories.map(category => {
                    const solved = caseFileAnswerFor(
                        setup,
                        knowledge,
                        category.name,
                    );
                    const candidates = caseFileCandidatesFor(
                        setup,
                        knowledge,
                        category.name,
                    );
                    return (
                        <div
                            key={String(category.name)}
                            className="rounded-[var(--radius)] border border-border bg-white p-2 text-center"
                        >
                            <div className="mb-1 text-[11px] uppercase tracking-[0.05em] text-muted">
                                {String(category.name)}
                            </div>
                            {solved ? (
                                <div className="text-[14px] font-semibold text-yes">
                                    {solved}
                                </div>
                            ) : (
                                <div className="text-[13px] text-muted">
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

const CELL_BASE =
    "w-9 min-w-9 border border-border px-2 py-1 text-center font-semibold";

const cellClass = (value: CellValue | undefined): string => {
    if (value === Y) return `${CELL_BASE} bg-yes-bg text-yes`;
    if (value === N) return `${CELL_BASE} bg-no-bg text-no`;
    return `${CELL_BASE} bg-white`;
};
