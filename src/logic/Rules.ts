import { pipe } from "effect";
import {
    CaseFileOwner,
    PlayerOwner,
} from "./GameObjects";
import {
    Cell,
    Contradiction,
    getCell,
    getHandSize,
    Knowledge,
    N,
    setCell,
    Y,
} from "./Knowledge";
import {
    allCards,
    allOwners,
    GameSetup,
} from "./GameSetup";
import { Suggestion, suggestionCards, suggestionNonRefuters } from "./Suggestion";

/**
 * A "slice" is a set of cells that has a known exact number of Ys among
 * them. Every consistency rule in Clue's inference reduces to this shape:
 *
 *   - "each card has exactly one owner"            → ||slice|| Y = 1
 *   - "each player's row sums to their hand size"  → ||slice|| Y = handSize
 *   - "the case file has exactly one of each category" → ||slice|| Y = 1
 *   - "the refuter owns at least one of the cards they refuted with"
 *     → ||slice|| Y = 1 (when suggestion has a refuter but no seen card)
 *
 * Given such a slice, two forward inferences follow:
 *   1. If we've already accounted for all `yCount` Ys, every remaining
 *      unknown cell must be N.
 *   2. If we've already accounted for (size − yCount) Ns, every remaining
 *      unknown cell must be Y.
 *
 * Collapsing every rule into this one shape replaces ~520 lines of
 * near-identical code in the original ConsistencyRules/DeductionRules
 * files with a single combinator plus a small amount of slice-generation
 * logic.
 */
export interface Slice {
    readonly cells: ReadonlyArray<Cell>;
    readonly yCount: number;
    readonly label: string; // for explanations / debugging
}

/**
 * Apply one slice: if its counts saturate either side of the constraint,
 * fill in every unknown cell with the forced value. If the counts
 * already exceed what's possible, raise a Contradiction (e.g. a slice
 * that should contain exactly 1 Y but already has 2).
 */
export const applySlice = (slice: Slice) => (knowledge: Knowledge): Knowledge => {
    let ys = 0;
    let ns = 0;
    const unknowns: Cell[] = [];
    for (const cell of slice.cells) {
        const v = getCell(knowledge, cell);
        if      (v === Y) ys++;
        else if (v === N) ns++;
        else              unknowns.push(cell);
    }

    const nCount = slice.cells.length - slice.yCount;

    // Over-saturation detection: the slice is already inconsistent.
    if (ys > slice.yCount) {
        throw new Contradiction(
            `slice "${slice.label}" has ${ys} Ys but expects exactly ${slice.yCount}`,
        );
    }
    if (ns > nCount) {
        throw new Contradiction(
            `slice "${slice.label}" has ${ns} Ns but expects at most ${nCount}`,
        );
    }

    if (unknowns.length === 0) return knowledge;

    // Rule 1: all Ys accounted for — remaining unknowns are forced N.
    if (ys >= slice.yCount && nCount > ns) {
        return unknowns.reduce((k, c) => setCell(k, c, N), knowledge);
    }

    // Rule 2: all Ns accounted for — remaining unknowns are forced Y.
    if (ns >= nCount && slice.yCount > ys) {
        return unknowns.reduce((k, c) => setCell(k, c, Y), knowledge);
    }

    return knowledge;
};

// ---- Slice generators --------------------------------------------------

/**
 * For each card, the slice "which owner has this card?" — exactly one Y.
 */
export const cardOwnershipSlices = (
    setup: GameSetup,
): ReadonlyArray<Slice> => {
    const owners = allOwners(setup);
    return allCards(setup).map(card => ({
        cells: owners.map(owner => Cell(owner, card)),
        yCount: 1,
        label: `card ownership: ${card}`,
    }));
};

/**
 * For each player whose hand size is known, the slice "which cards are in
 * this player's hand?" — exactly handSize Ys.
 */
export const playerHandSlices = (
    setup: GameSetup,
    knowledge: Knowledge,
): ReadonlyArray<Slice> =>
    setup.players.flatMap(player => {
        const owner = PlayerOwner(player);
        const handSize = getHandSize(knowledge, owner);
        if (handSize === undefined) return [];
        return [{
            cells: allCards(setup).map(card => Cell(owner, card)),
            yCount: handSize,
            label: `hand size: ${player}`,
        }];
    });

/**
 * For each category, the slice "which card is the case file's [category]?"
 * — exactly one Y. This replaces the two separate
 * `caseFileOwnsAtMost/AtLeast1PerCategory` rules from the original code.
 */
export const caseFileCategorySlices = (
    setup: GameSetup,
): ReadonlyArray<Slice> => {
    const caseFile = CaseFileOwner();
    return setup.categories.map(category => ({
        cells: category.cards.map(card => Cell(caseFile, card)),
        yCount: 1,
        label: `case file: ${category.name}`,
    }));
};

/**
 * For each suggestion that was refuted but where we didn't see which card
 * was used, the slice "which of these suggested cards does the refuter
 * own?" — exactly one Y. (They refuted, so they own at least one; but
 * they could own multiple, so this is actually a "≥1" constraint. We
 * approximate as exactly 1 for the purposes of forced-fill inference:
 * setting any remaining unknown to Y when all-but-one are N is still
 * sound; the "all Ys accounted for → fill with N" direction is *not*
 * sound here, so we suppress it by using yCount = 1 only as a lower
 * bound, not an upper bound.)
 *
 * Rather than complicate the slice combinator, we implement this rule
 * directly in `refuterOwnsOneOf` below.
 */

// ---- Suggestion-driven rules -------------------------------------------

/**
 * Players who passed on a suggestion (non-refuters) can't own any of the
 * cards named in that suggestion.
 */
export const nonRefutersDontHaveSuggestedCards = (
    suggestions: Iterable<Suggestion>,
) => (knowledge: Knowledge): Knowledge => {
    let k = knowledge;
    for (const suggestion of suggestions) {
        const cards = suggestionCards(suggestion);
        const nonRefuters = suggestionNonRefuters(suggestion);
        for (const player of nonRefuters) {
            const owner = PlayerOwner(player);
            for (const card of cards) {
                k = setCell(k, Cell(owner, card), N);
            }
        }
    }
    return k;
};

/**
 * If a refuter showed us a specific card, they own it.
 */
export const refuterShowedCard = (
    suggestions: Iterable<Suggestion>,
) => (knowledge: Knowledge): Knowledge => {
    let k = knowledge;
    for (const suggestion of suggestions) {
        if (suggestion.refuter === undefined) continue;
        if (suggestion.seenCard === undefined) continue;
        k = setCell(
            k,
            Cell(PlayerOwner(suggestion.refuter), suggestion.seenCard),
            Y,
        );
    }
    return k;
};

/**
 * If a player refuted a suggestion (so owns at least one of the three
 * cards), and we already know they don't own two of them, then they must
 * own the remaining one.
 */
export const refuterOwnsOneOf = (
    suggestions: Iterable<Suggestion>,
) => (knowledge: Knowledge): Knowledge => {
    let k = knowledge;
    for (const suggestion of suggestions) {
        if (suggestion.refuter === undefined) continue;
        if (suggestion.seenCard !== undefined) continue; // already handled
        const cards = suggestionCards(suggestion);
        const owner = PlayerOwner(suggestion.refuter);

        const unknowns: Cell[] = [];
        let alreadyYes = false;
        for (const card of cards) {
            const cell = Cell(owner, card);
            const v = getCell(k, cell);
            if      (v === Y) alreadyYes = true;
            else if (v === undefined) unknowns.push(cell);
        }

        if (alreadyYes) continue; // nothing new to infer

        // If exactly one card is still unknown, the refuter must own it.
        if (unknowns.length === 1) {
            k = setCell(k, unknowns[0], Y);
        }
    }
    return k;
};

// ---- Top-level rule application ----------------------------------------

/**
 * Apply every consistency slice once. This handles all 6 original
 * consistency rules (card ownership ±1, player hand size ±1, case file
 * category ±1) via a single combinator.
 */
export const applyConsistencyRules = (
    setup: GameSetup,
) => (knowledge: Knowledge): Knowledge => {
    const slices = [
        ...cardOwnershipSlices(setup),
        ...playerHandSlices(setup, knowledge),
        ...caseFileCategorySlices(setup),
    ];
    return slices.reduce((k, slice) => applySlice(slice)(k), knowledge);
};

/**
 * Apply every suggestion-driven rule once.
 */
export const applyDeductionRules = (
    suggestions: Iterable<Suggestion>,
) => (knowledge: Knowledge): Knowledge => pipe(
    knowledge,
    nonRefutersDontHaveSuggestedCards(suggestions),
    refuterShowedCard(suggestions),
    refuterOwnsOneOf(suggestions),
);

/**
 * A single pass: apply every consistency and deduction rule once. The
 * deducer calls this in a fixed-point loop until nothing changes.
 */
export const applyAllRules = (
    setup: GameSetup,
    suggestions: Iterable<Suggestion>,
) => (knowledge: Knowledge): Knowledge => pipe(
    knowledge,
    applyConsistencyRules(setup),
    applyDeductionRules(suggestions),
);

