"use client";

import { useState } from "react";
import { Card, Owner, ownerLabel } from "../../logic/GameObjects";
import { allOwners, cardName } from "../../logic/GameSetup";
import {
    Cell,
    CellValue,
    getCellByOwnerCard,
    Knowledge,
    N,
    Y,
} from "../../logic/Knowledge";
import { footnotesForCell } from "../../logic/Footnotes";
import {
    caseFileAnswerFor,
    caseFileCandidatesFor,
    caseFileProgress,
} from "../../logic/Recommender";
import { useClue } from "../state";
import { ContradictionBanner } from "./ContradictionBanner";
import {
    ExplanationFocus,
    ExplanationPanel,
} from "./ExplanationPanel";

/**
 * The main visual: a case-file header strip on top; a grid with one row
 * per card and one column per owner underneath. Cells show Y / N / blank,
 * are coloured by status, and are clickable: clicking a cell with a known
 * value opens the ExplanationPanel below the grid. Blank cells that are
 * still candidates for a refuter's unseen card get footnote superscripts
 * (the "number system").
 */
export function ChecklistGrid() {
    const { state, derived } = useClue();
    const setup = state.setup;
    const result = derived.deductionResult;
    const footnotes = derived.footnotes;

    const [focus, setFocus] = useState<ExplanationFocus | null>(null);

    const owners: ReadonlyArray<Owner> = allOwners(setup);

    if (result._tag === "Contradiction") {
        return (
            <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
                <h2 className="mb-3 text-[16px] uppercase tracking-[0.05em] text-accent">
                    Deduction grid
                </h2>
                <ContradictionBanner trace={result.trace} />
                <p className="text-[13px] text-muted">
                    Use a quick-fix above to resolve the contradiction, or
                    adjust your inputs directly.
                </p>
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
                    {setup.categories.flatMap(category => [
                        <tr key={`h-${String(category.id)}`}>
                            <th
                                colSpan={1 + owners.length}
                                className="border border-border bg-accent px-2 py-1.5 text-left text-[11px] uppercase tracking-[0.05em] text-white"
                            >
                                {category.name}
                            </th>
                        </tr>,
                        ...category.cards.map(entry => (
                            <tr key={String(entry.id)}>
                                <th className="border border-border px-2 py-1 text-left font-normal">
                                    {entry.name}
                                </th>
                                {owners.map(owner => (
                                    <GridCell
                                        key={`${ownerKey(owner)}-${String(entry.id)}`}
                                        owner={owner}
                                        card={entry.id}
                                        value={getCellByOwnerCard(
                                            knowledge,
                                            owner,
                                            entry.id,
                                        )}
                                        footnoteNumbers={footnotesForCell(
                                            footnotes,
                                            Cell(owner, entry.id),
                                        )}
                                        isFocused={
                                            focus !== null &&
                                            focus.owner === owner &&
                                            focus.card === entry.id
                                        }
                                        onSelect={f => setFocus(f)}
                                    />
                                ))}
                            </tr>
                        )),
                    ])}
                </tbody>
            </table>
            <ExplanationPanel
                focus={focus}
                onClose={() => setFocus(null)}
            />
        </section>
    );
}

function GridCell({
    owner,
    card,
    value,
    footnoteNumbers,
    isFocused,
    onSelect,
}: {
    owner: Owner;
    card: Card;
    value: CellValue | undefined;
    footnoteNumbers: ReadonlyArray<number>;
    isFocused: boolean;
    onSelect: (f: ExplanationFocus | null) => void;
}) {
    const canExplain = value !== undefined;
    const handleClick = () => {
        if (!canExplain) {
            onSelect(null);
            return;
        }
        if (isFocused) {
            onSelect(null);
        } else {
            onSelect({ owner, card, value: value as "Y" | "N" });
        }
    };

    return (
        <td
            className={cellClass(value, isFocused, canExplain)}
            onClick={handleClick}
            title={
                footnoteNumbers.length > 0
                    ? `Candidate for suggestion ${footnoteNumbers
                          .map(n => `#${n}`)
                          .join(", ")} (refuter's unseen card could be here)`
                    : canExplain
                        ? "Click for explanation"
                        : undefined
            }
        >
            {cellLabel(value)}
            {footnoteNumbers.length > 0 && value === undefined && (
                <sup className="ml-0.5 text-[9px] font-normal text-accent">
                    {footnoteNumbers.join(",")}
                </sup>
            )}
        </td>
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
                        category.id,
                    );
                    const candidates = caseFileCandidatesFor(
                        setup,
                        knowledge,
                        category.id,
                    );
                    return (
                        <div
                            key={String(category.id)}
                            className="rounded-[var(--radius)] border border-border bg-white p-2 text-center"
                        >
                            <div className="mb-1 text-[11px] uppercase tracking-[0.05em] text-muted">
                                {category.name}
                            </div>
                            {solved ? (
                                <div className="text-[14px] font-semibold text-yes">
                                    {cardName(setup, solved)}
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
    "w-9 min-w-9 border border-border px-2 py-1 text-center font-semibold relative";

const cellClass = (
    value: CellValue | undefined,
    isFocused: boolean,
    canExplain: boolean,
): string => {
    const base = canExplain ? `${CELL_BASE} cursor-pointer` : CELL_BASE;
    const focus = isFocused ? " ring-2 ring-accent ring-inset" : "";
    if (value === Y) return `${base} bg-yes-bg text-yes${focus}`;
    if (value === N) return `${base} bg-no-bg text-no${focus}`;
    return `${base} bg-white`;
};
