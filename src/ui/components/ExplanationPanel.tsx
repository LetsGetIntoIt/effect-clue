"use client";

import { Card, Owner, ownerLabel } from "../../logic/GameObjects";
import { cardName, GameSetup } from "../../logic/GameSetup";
import { Cell } from "../../logic/Knowledge";
import {
    chainFor,
    describeReason,
    Provenance,
} from "../../logic/Provenance";
import { Suggestion } from "../../logic/Suggestion";
import { useClue } from "../state";

/**
 * The cell the explanation panel is currently focused on. Owned in the
 * grid's local state and passed down; `null` hides the panel.
 */
export interface ExplanationFocus {
    readonly owner: Owner;
    readonly card: Card;
    readonly value: "Y" | "N";
}

/**
 * Sidebar-style panel that shows "why does this cell have this value?"
 * for whichever cell is focused. Walks the dependency chain backwards
 * via chainFor so you see root causes first, then each rule step that
 * used them.
 */
export function ExplanationPanel({
    focus,
    onClose,
}: {
    focus: ExplanationFocus | null;
    onClose: () => void;
}) {
    const { state, derived } = useClue();
    const setup = state.setup;
    const provenance = derived.provenance;
    const suggestions = derived.suggestionsAsData;

    if (!focus) return null;

    return (
        <aside className="mt-4 rounded-[var(--radius)] border border-border bg-case-file-bg p-3 text-[13px]">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                    <span className="font-semibold text-accent">
                        Why{" "}
                        {focus.value === "Y" ? "✓" : "·"}{" "}
                    </span>
                    at{" "}
                    <strong>{ownerLabel(focus.owner)}</strong>
                    {" / "}
                    <strong>{cardName(setup, focus.card)}</strong>
                    {" "}?
                </div>
                <button
                    type="button"
                    className="cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-muted hover:text-danger"
                    title="Close explanation"
                    onClick={onClose}
                >
                    &times;
                </button>
            </div>
            {provenance ? (
                <ExplanationChain
                    focus={focus}
                    provenance={provenance}
                    setup={setup}
                    suggestions={suggestions}
                />
            ) : (
                <div className="text-muted">
                    Enable &quot;Show why? explanations&quot; in the toolbar to
                    see the derivation.
                </div>
            )}
        </aside>
    );
}

function ExplanationChain({
    focus,
    provenance,
    setup,
    suggestions,
}: {
    focus: ExplanationFocus;
    provenance: Provenance;
    setup: GameSetup;
    suggestions: ReadonlyArray<Suggestion>;
}) {
    const chain = chainFor(provenance, Cell(focus.owner, focus.card));
    if (chain.length === 0) {
        return (
            <div className="text-muted">
                No explanation recorded for this cell.
            </div>
        );
    }
    return (
        <ol className="m-0 list-decimal pl-6">
            {chain.map((reason, i) => {
                const { headline, detail } = describeReason(
                    reason,
                    setup,
                    suggestions,
                );
                return (
                    <li key={i} className="mb-1">
                        <strong>{headline}</strong>
                        {reason.iteration > 0 && (
                            <span className="text-muted">
                                {" "}
                                · iteration {reason.iteration}
                            </span>
                        )}
                        <div>{detail}</div>
                    </li>
                );
            })}
        </ol>
    );
}
