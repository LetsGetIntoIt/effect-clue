import { PlayerOwner } from "./GameObjects";
import { Cell, getCell, Knowledge } from "./Knowledge";
import { Suggestion, suggestionCards } from "./Suggestion";
import { keyOf } from "./Provenance";

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
 */
export interface FootnoteMap {
    /** Map from cell key to the 1-indexed suggestion numbers. */
    readonly byCell: ReadonlyMap<string, ReadonlyArray<number>>;
}

export const emptyFootnotes: FootnoteMap = { byCell: new Map() };

export const refuterCandidateFootnotes = (
    suggestions: ReadonlyArray<Suggestion>,
    knowledge: Knowledge,
): FootnoteMap => {
    const byCell = new Map<string, number[]>();
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
            const key = keyOf(cell);
            const existing = byCell.get(key);
            if (existing) existing.push(index + 1);
            else byCell.set(key, [index + 1]);
        }
    });
    return { byCell };
};

export const footnotesForCell = (
    footnotes: FootnoteMap,
    cell: Cell,
): ReadonlyArray<number> => footnotes.byCell.get(keyOf(cell)) ?? [];
