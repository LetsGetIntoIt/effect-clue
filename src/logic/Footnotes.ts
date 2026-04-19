import { MutableHashMap, Option } from "effect";
import { PlayerOwner } from "./GameObjects";
import { Cell, getCell, Knowledge } from "./Knowledge";
import { Suggestion, suggestionCards } from "./Suggestion";

/**
 * For each "refuter owns one of these cards but we don't know which"
 * situation still alive in the knowledge, record the suggestion's
 * 1-indexed display number on every candidate cell. The UI renders
 * these as superscripts — `²,⁷` means "this cell is one of the
 * possibilities for the refuter of suggestion #2 and suggestion #7".
 *
 * A suggestion contributes footnotes only when:
 *   - it was refuted (`refuter` is set), AND
 *   - we did not see the refuting card (`seenCard` is undefined), AND
 *   - the refuter does not already have a Y on any of the suggested
 *     cards (once we've pinned the refuting card to a specific cell,
 *     the footnote is redundant — the UI shows ✓ instead).
 *
 * Cells that are already marked N for this refuter are excluded
 * automatically — they can't be the refuting card anymore.
 *
 * Storage: `byCell` is a `MutableHashMap<Cell, readonly number[]>` so
 * lookups use structural Cell equality (no string-key surrogate).
 * The inner number[] stays mutable during construction because we
 * append as suggestions accumulate; callers read it as
 * ReadonlyArray<number>.
 */
export interface FootnoteMap {
    readonly byCell: MutableHashMap.MutableHashMap<Cell, number[]>;
}

export const emptyFootnotes: FootnoteMap = {
    byCell: MutableHashMap.empty<Cell, number[]>(),
};

export const refuterCandidateFootnotes = (
    suggestions: ReadonlyArray<Suggestion>,
    knowledge: Knowledge,
): FootnoteMap => {
    const byCell = MutableHashMap.empty<Cell, number[]>();
    suggestions.forEach((suggestion, index) => {
        if (suggestion.refuter === undefined) return;
        if (suggestion.seenCard !== undefined) return;

        const refuterOwner = PlayerOwner(suggestion.refuter);
        const cards = suggestionCards(suggestion);

        // If the refuter already has a Y on one of the cards, the
        // suggestion is "solved" — no footnote needed.
        const alreadyKnown = cards.some(card =>
            getCell(knowledge, Cell(refuterOwner, card)) === "Y");
        if (alreadyKnown) return;

        for (const card of cards) {
            const cell = Cell(refuterOwner, card);
            const value = getCell(knowledge, cell);
            if (value === "N") continue; // can't be the refuting card
            // Unknown (or Y, but Y was filtered above) → candidate.
            const existing = Option.getOrUndefined(
                MutableHashMap.get(byCell, cell),
            );
            if (existing) existing.push(index + 1);
            else MutableHashMap.set(byCell, cell, [index + 1]);
        }
    });
    return { byCell };
};

export const footnotesForCell = (
    footnotes: FootnoteMap,
    cell: Cell,
): ReadonlyArray<number> =>
    Option.getOrElse(
        MutableHashMap.get(footnotes.byCell, cell),
        () => [] as ReadonlyArray<number>,
    );
