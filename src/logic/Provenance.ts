import { Equal, HashMap } from "effect";
import { Card, CardCategory, Owner, ownerLabel, Player } from "./GameObjects";
import { Cell, CellValue, Knowledge } from "./Knowledge";
import { applyConsistencyRules, applyDeductionRules } from "./Rules";
import {
    cardName,
    categoryName,
    GameSetup,
} from "./GameSetup";
import { Suggestion, suggestionCards } from "./Suggestion";

/**
 * Structured identity of the rule family that produced a deduction.
 * This is richer than just a string tag — the UI renders different
 * explanations depending on `kind`, and "offer a quick fix" for
 * contradictions needs to identify the originating suggestion or
 * input.
 */
export type ReasonKind =
    | { readonly kind: "initial-known-card" }
    | { readonly kind: "initial-hand-size" }
    | { readonly kind: "card-ownership"; readonly card: Card }
    | { readonly kind: "player-hand"; readonly player: Player }
    | { readonly kind: "case-file-category"; readonly category: CardCategory }
    | { readonly kind: "non-refuters"; readonly suggestionIndex: number }
    | { readonly kind: "refuter-showed"; readonly suggestionIndex: number }
    | { readonly kind: "refuter-owns-one-of"; readonly suggestionIndex: number };

/**
 * A short, human-readable reason for why a particular cell has the value
 * it does. These power the "why do we know this?" feature in the UI —
 * hovering / clicking a cell in the checklist walks the `dependsOn`
 * chain backwards to rebuild the derivation.
 *
 * - `iteration`: 0 for initial inputs, 1+ for rule passes.
 * - `kind`:      structured identity of the rule that set this cell.
 * - `detail`:    free-form human-readable detail.
 * - `dependsOn`: cells whose values were consulted to derive this one.
 *                For initial inputs this is empty. For slice-based
 *                deductions it's the already-set cells in the slice.
 *                For suggestion-driven rules it's typically the cells
 *                the rule inspected (e.g. the two N cells that made
 *                `refuterOwnsOneOf` narrow down to the third).
 */
export interface Reason {
    readonly iteration: number;
    readonly kind: ReasonKind;
    readonly detail: string;
    readonly dependsOn: ReadonlyArray<Cell>;
}

export type Provenance = Map<string, Reason>;

/**
 * A single cell-setting event emitted by a rule while the tracer is
 * hooked up. Rules that don't set any cells don't emit anything; rules
 * that set multiple cells emit multiple events. First-write-wins in the
 * provenance map — subsequent rules that "re-set" the same cell to the
 * same value don't overwrite the original explanation.
 */
export interface SetCellRecord {
    readonly cell: Cell;
    readonly value: CellValue;
    readonly kind: ReasonKind;
    readonly detail: string;
    readonly dependsOn: ReadonlyArray<Cell>;
}

/**
 * Optional callback threaded through the rule layer so that
 * `deduceWithExplanations` can record per-cell provenance without the
 * rule code caring. When a rule passes `undefined` (the fast `deduce`
 * path), the tracer is skipped entirely — zero overhead.
 */
export type Tracer = (record: SetCellRecord) => void;

export const keyOf = (cell: Cell): string => {
    const [owner, card] = cell;
    return `${ownerLabel(owner)}|${card}`;
};

export const explainCell = (
    provenance: Provenance,
    owner: Owner,
    card: Card,
): Reason | undefined => provenance.get(keyOf(Cell(owner, card)));

/**
 * Walk the provenance chain for a cell, producing the full list of
 * reasons in dependency order (root causes first). Used by the
 * ExplanationPanel to render the derivation chain.
 */
export const chainFor = (
    provenance: Provenance,
    cell: Cell,
): ReadonlyArray<Reason> => {
    const seen = new Set<string>();
    const out: Reason[] = [];
    const stack: Cell[] = [cell];
    while (stack.length > 0) {
        const next = stack.pop()!;
        const key = keyOf(next);
        if (seen.has(key)) continue;
        seen.add(key);
        const reason = provenance.get(key);
        if (!reason) continue;
        out.push(reason);
        for (const dep of reason.dependsOn) stack.push(dep);
    }
    return out.reverse();
};

/**
 * Turn a single Reason into a user-facing sentence. Uses the setup and
 * suggestions arrays to resolve ids into display names / suggestion
 * numbers, so the UI doesn't have to repeat that lookup per render.
 *
 * Returns an object with a short `headline` (rule family) and a longer
 * `detail` (full explanation). The headline is suitable for bold
 * labels; detail is the prose.
 */
export interface DescribedReason {
    readonly headline: string;
    readonly detail: string;
}

export const describeReason = (
    reason: Reason,
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
): DescribedReason => {
    switch (reason.kind.kind) {
        case "initial-known-card":
            return {
                headline: "Given",
                detail: "You marked this cell in the known-cards grid.",
            };
        case "initial-hand-size":
            return {
                headline: "Given",
                detail: "Known from the player's hand size.",
            };
        case "card-ownership":
            return {
                headline: "Card ownership",
                detail:
                    `Each card has exactly one owner. Once ` +
                    `${cardName(setup, reason.kind.card)} was ruled in ` +
                    `or out for other owners, this cell was forced.`,
            };
        case "player-hand":
            return {
                headline: "Hand size",
                detail:
                    `${reason.kind.player}'s hand holds a fixed number of ` +
                    `cards. Counting the Ys and Ns in their row forced ` +
                    `this cell.`,
            };
        case "case-file-category":
            return {
                headline: "Case file",
                detail:
                    `The case file contains exactly one ` +
                    `${categoryName(setup, reason.kind.category)}. ` +
                    `Narrowing the category forced this cell.`,
            };
        case "non-refuters": {
            const s = suggestions[reason.kind.suggestionIndex];
            const n = reason.kind.suggestionIndex + 1;
            if (!s)
                return {
                    headline: `Suggestion #${n}`,
                    detail: "A player who passed can't hold the named cards.",
                };
            return {
                headline: `Suggestion #${n}`,
                detail:
                    `The passer couldn't refute ${s.suggester}'s ` +
                    `suggestion, so they don't own any of the named cards.`,
            };
        }
        case "refuter-showed": {
            const s = suggestions[reason.kind.suggestionIndex];
            const n = reason.kind.suggestionIndex + 1;
            if (!s)
                return {
                    headline: `Suggestion #${n}`,
                    detail: "Refuter showed the card.",
                };
            const seen =
                s.seenCard !== undefined
                    ? cardName(setup, s.seenCard)
                    : "the refuting card";
            return {
                headline: `Suggestion #${n}`,
                detail: `${s.refuter} refuted and showed ${seen}.`,
            };
        }
        case "refuter-owns-one-of": {
            const s = suggestions[reason.kind.suggestionIndex];
            const n = reason.kind.suggestionIndex + 1;
            if (!s)
                return {
                    headline: `Suggestion #${n}`,
                    detail:
                        "Refuter had to own one of the three cards; the " +
                        "other two were already ruled out.",
                };
            const cardLabels = suggestionCards(s)
                .map(id => cardName(setup, id))
                .join(", ");
            return {
                headline: `Suggestion #${n}`,
                detail:
                    `${s.refuter} refuted ${s.suggester}'s suggestion ` +
                    `(${cardLabels}) but we didn't see the card. Once ` +
                    `the other two were ruled out, this one was forced.`,
            };
        }
    }
};

/** Same as describeReason but formats as a flat string. */
export const describeReasonString = (
    reason: Reason,
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
): string => {
    const d = describeReason(reason, setup, suggestions);
    return `${d.headline}: ${d.detail}`;
};

/**
 * Run the deducer once and record, for every cell that was newly
 * assigned, the rule iteration and kind that first set it. This is a
 * separate traced deduction path — the regular `deduce` stays fast and
 * pure — so the UI can opt in to explanations without paying the cost
 * for every recompute.
 */
export const deduceWithExplanations = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    initial: Knowledge,
): { knowledge: Knowledge; provenance: Provenance } => {
    const provenance: Provenance = new Map();
    let current = initial;
    let currentIteration = 0;

    // Seed provenance with the initial inputs so the UI can explain
    // them as "you told us this".
    HashMap.forEach(initial.checklist, (_value, cell) => {
        provenance.set(keyOf(cell), {
            iteration: 0,
            kind: { kind: "initial-known-card" },
            detail: "given from starting knowledge",
            dependsOn: [],
        });
    });

    const tracer: Tracer = (record) => {
        const key = keyOf(record.cell);
        if (provenance.has(key)) return; // first-write-wins
        provenance.set(key, {
            iteration: currentIteration,
            kind: record.kind,
            detail: record.detail,
            dependsOn: record.dependsOn,
        });
    };

    const maxIterations = 1000;
    for (let i = 0; i < maxIterations; i++) {
        currentIteration = i + 1;
        const before = current;
        current = applyConsistencyRules(setup, tracer)(current);
        current = applyDeductionRules(suggestions, tracer)(current);
        if (Equal.equals(current, before)) break;
    }

    return { knowledge: current, provenance };
};
