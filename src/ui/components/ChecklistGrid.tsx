"use client";

import { Either } from "effect";
import { Card, Owner, ownerLabel } from "../../logic/GameObjects";
import { allOwners, cardName } from "../../logic/GameSetup";
import {
    Cell,
    CellValue,
    emptyKnowledge,
    getCellByOwnerCard,
    Knowledge,
    N,
    Y,
} from "../../logic/Knowledge";
import { footnotesForCell } from "../../logic/Footnotes";
import {
    chainFor,
    describeReason,
    Provenance,
} from "../../logic/Provenance";
import {
    caseFileAnswerFor,
    caseFileCandidatesFor,
    caseFileProgress,
} from "../../logic/Recommender";
import { Suggestion } from "../../logic/Suggestion";
import { useClue } from "../state";

/**
 * The main visual: a case-file header strip on top; a grid with one row
 * per card and one column per owner underneath. Cells show Y / N / blank,
 * are coloured by status, and show a native browser tooltip (via the
 * `title` attribute) with the full explanation chain when you hover.
 * Blank cells that are still candidates for a refuter's unseen card
 * get footnote superscripts (the "number system"), also described via
 * the title tooltip.
 *
 * We deliberately stick to `title` rather than a custom popover so the
 * hover affordance is the same everywhere — no difference between a
 * ✓ / · cell and a blank-with-footnote cell.
 */
export function ChecklistGrid() {
    const { state, dispatch, derived } = useClue();
    const setup = state.setup;
    const knownCards = state.knownCards;
    const result = derived.deductionResult;
    const footnotes = derived.footnotes;
    const provenance = derived.provenance;
    const suggestions = derived.suggestionsAsData;

    const owners: ReadonlyArray<Owner> = allOwners(setup);

    /**
     * Toggle a known-card entry for (player, card) when the user clicks a
     * cell. Only player columns are interactive — the CaseFile column is
     * computed by the deducer and never a direct user input.
     *
     * If the clicked (player, card) is already in knownCards, remove it;
     * otherwise add it. If the cell currently shows N (deduced), clicking
     * will add a Y known-card that contradicts — the global banner will
     * show the user why.
     */
    const toggleKnownCard = (owner: Owner, card: Card) => {
        if (owner._tag !== "Player") return;
        const player = owner.player;
        const index = knownCards.findIndex(
            kc => kc.player === player && kc.card === card,
        );
        if (index >= 0) {
            dispatch({ type: "removeKnownCard", index });
        } else {
            dispatch({ type: "addKnownCard", card: { player, card } });
        }
    };

    // While the deducer is in a contradictory state, fall back to the
    // empty-knowledge snapshot so the grid still renders (with the
    // user's known-card inputs visible). The global contradiction banner
    // at the top of the page surfaces the quick-fix UI; we don't block
    // the grid anymore.
    const knowledge: Knowledge = Either.isRight(result)
        ? result.right
        : emptyKnowledge;

    return (
        <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
            <h2 className="mb-3 text-[16px] uppercase tracking-[0.05em] text-accent">
                Deduction grid
            </h2>
            <CaseFileHeader knowledge={knowledge} />
            <table className="w-full border-collapse text-[13px]">
                <thead>
                    <tr>
                        <th className="sticky top-0 z-10 border border-border bg-row-header px-2 py-1 text-center font-semibold"></th>
                        {owners.map(owner => (
                            <th
                                key={ownerKey(owner)}
                                className="sticky top-0 z-10 border border-border bg-row-header px-2 py-1 text-center font-semibold"
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
                                {owners.map(owner => {
                                    const value = getCellByOwnerCard(
                                        knowledge,
                                        owner,
                                        entry.id,
                                    );
                                    const footnoteNumbers = footnotesForCell(
                                        footnotes,
                                        Cell(owner, entry.id),
                                    );
                                    const isPlayerCell = owner._tag === "Player";
                                    return (
                                        <td
                                            key={`${ownerKey(owner)}-${String(entry.id)}`}
                                            className={cellClass(
                                                value,
                                                isPlayerCell,
                                            )}
                                            title={buildCellTitle({
                                                provenance,
                                                suggestions,
                                                setup,
                                                owner,
                                                card: entry.id,
                                                footnoteNumbers,
                                            })}
                                            onClick={
                                                isPlayerCell
                                                    ? () =>
                                                          toggleKnownCard(
                                                              owner,
                                                              entry.id,
                                                          )
                                                    : undefined
                                            }
                                            role={isPlayerCell ? "button" : undefined}
                                            tabIndex={isPlayerCell ? 0 : undefined}
                                            onKeyDown={
                                                isPlayerCell
                                                    ? e => {
                                                          if (
                                                              e.key === "Enter" ||
                                                              e.key === " "
                                                          ) {
                                                              e.preventDefault();
                                                              toggleKnownCard(
                                                                  owner,
                                                                  entry.id,
                                                              );
                                                          }
                                                      }
                                                    : undefined
                                            }
                                        >
                                            {cellLabel(value)}
                                            {footnoteNumbers.length > 0 &&
                                                value === undefined && (
                                                    <sup className="ml-0.5 text-[9px] font-normal text-accent">
                                                        {footnoteNumbers.join(",")}
                                                    </sup>
                                                )}
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

/**
 * Assemble the title= string shown on hover. For known Y/N cells we walk
 * the dependency chain backwards and render each step as a numbered line
 * so the user sees *why* the cell has that value, not just the last
 * rule. For blank cells with refuter-candidate footnotes we explain the
 * footnote numbers. For everything else, no tooltip at all.
 */
const buildCellTitle = (args: {
    provenance: Provenance | undefined;
    suggestions: ReadonlyArray<Suggestion>;
    setup: ReturnType<typeof useClue>["state"]["setup"];
    owner: Owner;
    card: Card;
    footnoteNumbers: ReadonlyArray<number>;
}): string | undefined => {
    const { provenance, suggestions, setup, owner, card, footnoteNumbers } = args;

    const footnoteLine =
        footnoteNumbers.length > 0
            ? `Candidate for suggestion ${footnoteNumbers
                  .map(n => `#${n}`)
                  .join(", ")} — refuter's unseen card could be here.`
            : undefined;

    const chain = provenance
        ? chainFor(provenance, Cell(owner, card))
        : [];
    const chainLines: string[] = chain.map((reason, i) => {
        const { headline, detail } = describeReason(
            reason,
            setup,
            suggestions,
        );
        const iter = reason.iteration > 0 ? ` (iter ${reason.iteration})` : "";
        return `${i + 1}. ${headline}${iter}: ${detail}`;
    });

    const parts: string[] = [];
    if (chainLines.length > 0) {
        parts.push("Why this value:");
        parts.push(...chainLines);
    }
    if (footnoteLine) parts.push(footnoteLine);

    return parts.length > 0 ? parts.join("\n") : undefined;
};

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

const CELL_INTERACTIVE =
    " cursor-pointer hover:ring-2 hover:ring-accent/40 focus:outline-none focus:ring-2 focus:ring-accent";

const cellClass = (
    value: CellValue | undefined,
    interactive: boolean,
): string => {
    const base = interactive ? `${CELL_BASE}${CELL_INTERACTIVE}` : CELL_BASE;
    if (value === Y) return `${base} bg-yes-bg text-yes`;
    if (value === N) return `${base} bg-no-bg text-no`;
    return `${base} bg-white`;
};
