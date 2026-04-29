import { Match, pipe } from "effect";
import {
    Card,
    CaseFileOwner,
    Player,
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
import { ContradictionKind } from "./ContradictionKind";
import {
    allCardIds,
    allOwners,
    GameSetup,
} from "./GameSetup";
import { Accusation, accusationCards } from "./Accusation";
import { Suggestion, suggestionCards, suggestionNonRefuters } from "./Suggestion";
import { cardIdsInCategory, categoryOfCard } from "./CardSet";
import type { ReasonKind, Tracer } from "./Provenance";
import {
    CardOwnership,
    CaseFileCategory,
    DisjointGroupsHandLock,
    FailedAccusation,
    FailedAccusationPairwiseNarrowing,
    NonRefuters,
    PlayerHand,
    RefuterOwnsOneOf,
    RefuterShowed,
} from "./Provenance";

/**
 * Map a slice's `ReasonKind` (which always identifies one of three
 * consistency families — card ownership, player hand, case-file
 * category) to the matching `ContradictionKind` so the UI can name
 * which constraint over- or under-saturated.
 *
 * Slices are never built from `NonRefuters` / `RefuterShowed` /
 * `RefuterOwnsOneOf` / `InitialKnownCard` / `InitialHandSize` — those
 * are deduction-rule kinds, not consistency-rule kinds — so the
 * default branch should never fire at runtime, but typescript-narrows
 * to those tags want a fallback.
 */
const sliceKindToContradiction = (
    kind: ReasonKind,
    direction: "over" | "under",
    handSize: number,
): ContradictionKind =>
    Match.value(kind).pipe(
        Match.tag("CardOwnership", ({ card }) => ({
            _tag: "SliceCardOwnership" as const,
            card,
            direction,
        })),
        Match.tag("PlayerHand", ({ player }) => ({
            _tag: "SlicePlayerHand" as const,
            player,
            handSize,
            direction,
        })),
        Match.tag("CaseFileCategory", ({ category }) => ({
            _tag: "SliceCaseFileCategory" as const,
            category,
            direction,
        })),
        Match.orElse(
            (): ContradictionKind => ({ _tag: "DirectCell" }),
        ),
    );

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
    readonly kind: ReasonKind; // structured identity for provenance
}

/**
 * Apply one slice: if its counts saturate either side of the constraint,
 * fill in every unknown cell with the forced value. If the counts
 * already exceed what's possible, raise a Contradiction (e.g. a slice
 * that should contain exactly 1 Y but already has 2).
 *
 * When a tracer is supplied, every newly-set cell is reported along
 * with the cells in the slice that made the deduction possible — i.e.
 * every cell in the slice that was already known. The fast `deduce`
 * path passes no tracer and pays no overhead.
 */
export const applySlice = (
    slice: Slice,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => {
    let ys = 0;
    let ns = 0;
    const yCells: Cell[] = [];
    const nCells: Cell[] = [];
    const unknowns: Cell[] = [];
    for (const cell of slice.cells) {
        const v = getCell(knowledge, cell);
        if      (v === Y) { ys++; yCells.push(cell); }
        else if (v === N) { ns++; nCells.push(cell); }
        else              unknowns.push(cell);
    }

    const nCount = slice.cells.length - slice.yCount;

    // Over-saturation detection: the slice is already inconsistent.
    if (ys > slice.yCount) {
        throw new Contradiction({
            reason:
                `slice "${slice.label}" has ${ys} Ys but expects ` +
                `exactly ${slice.yCount}`,
            offendingCells: yCells,
            sliceLabel: slice.label,
            contradictionKind: sliceKindToContradiction(
                slice.kind,
                "over",
                slice.yCount,
            ),
        });
    }
    if (ns > nCount) {
        throw new Contradiction({
            reason:
                `slice "${slice.label}" has ${ns} Ns but expects ` +
                `at most ${nCount}`,
            offendingCells: nCells,
            sliceLabel: slice.label,
            contradictionKind: sliceKindToContradiction(
                slice.kind,
                "under",
                slice.yCount,
            ),
        });
    }

    if (unknowns.length === 0) return knowledge;

    // Rule 1: all Ys accounted for — remaining unknowns are forced N.
    if (ys >= slice.yCount && nCount > ns) {
        return unknowns.reduce((k, cell) => {
            const next = setCell(k, cell, N);
            if (next !== k && tracer) {
                tracer({
                    cell,
                    value: N,
                    kind: slice.kind,
                    dependsOn: yCells,
                });
            }
            return next;
        }, knowledge);
    }

    // Rule 2: all Ns accounted for — remaining unknowns are forced Y.
    if (ns >= nCount && slice.yCount > ys) {
        return unknowns.reduce((k, cell) => {
            const next = setCell(k, cell, Y);
            if (next !== k && tracer) {
                tracer({
                    cell,
                    value: Y,
                    kind: slice.kind,
                    dependsOn: nCells,
                });
            }
            return next;
        }, knowledge);
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
    return setup.categories.flatMap(category =>
        category.cards.map(entry => ({
            cells: owners.map(owner => Cell(owner, entry.id)),
            yCount: 1,
            label: `card ownership: ${entry.name}`,
            kind: CardOwnership({ card: entry.id }),
        })),
    );
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
            cells: allCardIds(setup).map(card => Cell(owner, card)),
            yCount: handSize,
            label: `hand size: ${player}`,
            kind: PlayerHand({ player }),
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
        cells: category.cards.map(entry => Cell(caseFile, entry.id)),
        yCount: 1,
        label: `case file: ${category.name}`,
        kind: CaseFileCategory({ category: category.id }),
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
    suggestions: ReadonlyArray<Suggestion>,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => {
    let k = knowledge;
    suggestions.forEach((suggestion, suggestionIndex) => {
        const cards = suggestionCards(suggestion);
        const nonRefuters = suggestionNonRefuters(suggestion);
        for (const player of nonRefuters) {
            const owner = PlayerOwner(player);
            for (const card of cards) {
                const cell = Cell(owner, card);
                const before = k;
                try {
                    k = setCell(k, cell, N);
                } catch (e) {
                    if (e instanceof Contradiction) {
                        throw new Contradiction({
                            reason: e.reason,
                            offendingCells: e.offendingCells.length
                                ? e.offendingCells
                                : [cell],
                            sliceLabel: e.sliceLabel,
                            suggestionIndex,
                            contradictionKind: {
                                _tag: "NonRefuters",
                                suggestionIndex,
                            },
                        });
                    }
                    throw e;
                }
                if (k !== before && tracer) {
                    tracer({
                        cell,
                        value: N,
                        kind: NonRefuters({ suggestionIndex }),
                        dependsOn: [],
                    });
                }
            }
        }
    });
    return k;
};

/**
 * If a refuter showed us a specific card, they own it.
 */
export const refuterShowedCard = (
    suggestions: ReadonlyArray<Suggestion>,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => {
    let k = knowledge;
    suggestions.forEach((suggestion, suggestionIndex) => {
        if (suggestion.refuter === undefined) return;
        if (suggestion.seenCard === undefined) return;
        const cell = Cell(PlayerOwner(suggestion.refuter), suggestion.seenCard);
        const before = k;
        try {
            k = setCell(k, cell, Y);
        } catch (e) {
            if (e instanceof Contradiction) {
                throw new Contradiction({
                    reason: e.reason,
                    offendingCells: e.offendingCells.length
                        ? e.offendingCells
                        : [cell],
                    sliceLabel: e.sliceLabel,
                    suggestionIndex,
                    contradictionKind: {
                        _tag: "RefuterShowed",
                        suggestionIndex,
                    },
                });
            }
            throw e;
        }
        if (k !== before && tracer) {
            tracer({
                cell,
                value: Y,
                kind: RefuterShowed({ suggestionIndex }),
                dependsOn: [],
            });
        }
    });
    return k;
};

/**
 * If a player refuted a suggestion (so owns at least one of the three
 * cards), and we already know they don't own two of them, then they must
 * own the remaining one.
 */
export const refuterOwnsOneOf = (
    suggestions: ReadonlyArray<Suggestion>,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => {
    let k = knowledge;
    suggestions.forEach((suggestion, suggestionIndex) => {
        if (suggestion.refuter === undefined) return;
        if (suggestion.seenCard !== undefined) return; // already handled
        const cards = suggestionCards(suggestion);
        const owner = PlayerOwner(suggestion.refuter);

        const unknowns: Cell[] = [];
        const nCells: Cell[] = [];
        let alreadyYes = false;
        for (const card of cards) {
            const cell = Cell(owner, card);
            const v = getCell(k, cell);
            if      (v === Y) alreadyYes = true;
            else if (v === N) nCells.push(cell);
            else              unknowns.push(cell);
        }

        if (alreadyYes) return; // nothing new to infer

        // If exactly one card is still unknown, the refuter must own it.
        const [cell, ...rest] = unknowns;
        if (cell !== undefined && rest.length === 0) {
            const before = k;
            try {
                k = setCell(k, cell, Y);
            } catch (e) {
                if (e instanceof Contradiction) {
                    throw new Contradiction({
                        reason: e.reason,
                        offendingCells: e.offendingCells.length
                            ? e.offendingCells
                            : [cell, ...nCells],
                        sliceLabel: e.sliceLabel,
                        suggestionIndex,
                        contradictionKind: {
                            _tag: "RefuterOwnsOneOf",
                            suggestionIndex,
                        },
                    });
                }
                throw e;
            }
            if (k !== before && tracer) {
                tracer({
                    cell,
                    value: Y,
                    kind: RefuterOwnsOneOf({ suggestionIndex }),
                    dependsOn: nCells,
                });
            }
        }
    });
    return k;
};

/**
 * Disjoint-groups hand lock. Runs across every player's refuted
 * suggestions. If a single player P has refuted K suggestions whose
 * (still-unknown-for-P) card sets are pairwise disjoint, P must own at
 * least one card from each of those K disjoint sets. When K equals
 * P's remaining unknown hand slots (`handSize − knownYs`), P's hand is
 * exactly one card per set and every other card in P's row must be N.
 *
 * Strictly stronger than `refuterOwnsOneOf`: at K=1 it reduces to that
 * rule, but it doesn't fire below K=2 — single-suggestion narrowing is
 * left to `refuterOwnsOneOf` to keep the provenance story clean.
 *
 * Edge cases:
 *   - We filter each suggestion's cards down to those still unknown for
 *     P. A set already containing a Y is satisfied by that Y and is
 *     dropped (its yCount counts via `knownYs`); a set whose unknowns
 *     are all N is impossible — but `refuterOwnsOneOf` and the slice
 *     combinator catch that case earlier, so we just skip it.
 *   - K > handRemaining: P would owe at least K distinct cards but has
 *     fewer slots. Throw a Contradiction tagged with all K
 *     contributing suggestion indices.
 *
 * The rule sits before `refuterOwnsOneOf` in `applyDeductionRules` so
 * any new Ns it discovers are visible to that rule in the same pass.
 */
export const disjointGroupsHandLock = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => {
    // Bucket every "refuted but unseen" suggestion by its refuter.
    const byRefuter = new Map<
        Player,
        Array<{ readonly index: number; readonly cards: ReadonlyArray<Card> }>
    >();
    suggestions.forEach((s, index) => {
        if (s.refuter === undefined) return;
        if (s.seenCard !== undefined) return;
        const list = byRefuter.get(s.refuter) ?? [];
        list.push({ index, cards: suggestionCards(s) });
        byRefuter.set(s.refuter, list);
    });

    let k = knowledge;
    for (const [player, entries] of byRefuter) {
        if (entries.length < 2) continue; // single suggestion → refuterOwnsOneOf handles it
        const owner = PlayerOwner(player);
        const handSize = getHandSize(k, owner);
        if (handSize === undefined) continue;

        // Filter each set to cells still unknown for the refuter; drop
        // already-Y sets entirely (satisfied) and skip already-impossible
        // sets (refuterOwnsOneOf / slice will surface the contradiction
        // separately).
        const filtered: Array<{
            readonly index: number;
            readonly cards: ReadonlyArray<Card>;
        }> = [];
        for (const entry of entries) {
            let containsY = false;
            const stillUnknown: Card[] = [];
            for (const card of entry.cards) {
                const v = getCell(k, Cell(owner, card));
                if (v === Y) { containsY = true; break; }
                if (v === undefined) stillUnknown.push(card);
            }
            if (containsY) continue;
            if (stillUnknown.length === 0) continue;
            filtered.push({ index: entry.index, cards: stillUnknown });
        }
        if (filtered.length < 2) continue;

        // Pairwise disjointness: a Set<Card> stays small (≤ 9 entries
        // per filtered set) so this is O(Σ |filtered|).
        const union = new Set<Card>();
        let disjoint = true;
        for (const f of filtered) {
            for (const card of f.cards) {
                if (union.has(card)) { disjoint = false; break; }
                union.add(card);
            }
            if (!disjoint) break;
        }
        if (!disjoint) continue;

        // Count Ys already known on P's row.
        let ysInRow = 0;
        for (const card of allCardIds(setup)) {
            if (getCell(k, Cell(owner, card)) === Y) ysInRow++;
        }
        const handRemaining = handSize - ysInRow;
        const groupCount = filtered.length;

        if (groupCount > handRemaining) {
            throw new Contradiction({
                reason:
                    `${String(player)} refuted ${groupCount} disjoint ` +
                    `suggestion groups but has only ${handRemaining} ` +
                    `unknown hand slot${handRemaining === 1 ? "" : "s"} left`,
                offendingCells: filtered.flatMap(f =>
                    f.cards.map(c => Cell(owner, c)),
                ),
                contradictionKind: {
                    _tag: "DisjointGroupsHandLock",
                    player,
                    suggestionIndices: filtered.map(f => f.index),
                },
            });
        }
        if (groupCount !== handRemaining) continue;

        // Fire: every unknown cell in P's row outside the union must be N.
        const suggestionIndices = filtered.map(f => f.index);
        const unionCells: Cell[] = filtered.flatMap(f =>
            f.cards.map(c => Cell(owner, c)),
        );
        for (const card of allCardIds(setup)) {
            if (union.has(card)) continue;
            const cell = Cell(owner, card);
            if (getCell(k, cell) !== undefined) continue;
            const before = k;
            try {
                k = setCell(k, cell, N);
            } catch (e) {
                if (e instanceof Contradiction) {
                    throw new Contradiction({
                        reason: e.reason,
                        offendingCells: e.offendingCells.length
                            ? e.offendingCells
                            : [cell, ...unionCells],
                        sliceLabel: e.sliceLabel,
                        contradictionKind: {
                            _tag: "DisjointGroupsHandLock",
                            player,
                            suggestionIndices,
                        },
                    });
                }
                throw e;
            }
            if (k !== before && tracer) {
                tracer({
                    cell,
                    value: N,
                    kind: DisjointGroupsHandLock({
                        player,
                        suggestionIndices,
                    }),
                    dependsOn: unionCells,
                });
            }
        }
    }
    return k;
};

// ---- Accusation-driven rules -------------------------------------------

/**
 * Failed-accusation elimination. Every accusation that didn't end the
 * game is now public information: the case file's suspect / weapon /
 * room is *not* the named triple. So if two of the three are already
 * pinned to Y in the case file row (their categories deduced), the
 * remaining card must be N for the case file.
 *
 * Truth table (over the three case-file cells named by the accusation):
 *   - any cell already N        → rule satisfied; no inference.
 *   - 0 / 1 cells Y, no Ns      → not enough evidence; no inference.
 *   - exactly 2 cells Y, 1 unknown → force the unknown to N.
 *   - all 3 cells Y             → contradiction (the accusation would
 *                                 have been correct, but it failed).
 *
 * Order in `applyAllRules`: we run accusation rules *after*
 * `applyDeductionRules` so the suggestion-driven Ys / Ns it lands have
 * already cascaded through. The rule only ever sets case-file N cells,
 * which the consistency slices on the next iteration can use to force
 * other Ys (e.g. "this category now has only one candidate left").
 */
export const failedAccusationEliminate = (
    accusations: ReadonlyArray<Accusation>,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => {
    let k = knowledge;
    accusations.forEach((accusation, accusationIndex) => {
        const caseFile = CaseFileOwner();
        const cards = accusationCards(accusation);
        const yCells: Cell[] = [];
        const unknowns: Cell[] = [];
        let anyN = false;
        for (const card of cards) {
            const cell = Cell(caseFile, card);
            const v = getCell(k, cell);
            if      (v === Y) yCells.push(cell);
            else if (v === N) { anyN = true; break; }
            else              unknowns.push(cell);
        }
        if (anyN) return; // rule satisfied — case file definitely isn't this triple

        // All three cells already Y means the failed accusation matched
        // the case file, which can't happen in a well-formed game.
        if (yCells.length === cards.length && unknowns.length === 0) {
            throw new Contradiction({
                reason:
                    `accusation #${accusationIndex + 1} failed but every card ` +
                    `it named is already known to be in the case file`,
                offendingCells: yCells,
                accusationIndex,
                contradictionKind: {
                    _tag: "FailedAccusation",
                    accusationIndex,
                },
            });
        }

        // Exactly one unknown with the rest Y → force the unknown to N.
        if (yCells.length === cards.length - 1 && unknowns.length === 1) {
            const [cell] = unknowns;
            if (cell === undefined) return;
            const before = k;
            try {
                k = setCell(k, cell, N);
            } catch (e) {
                if (e instanceof Contradiction) {
                    throw new Contradiction({
                        reason: e.reason,
                        offendingCells: e.offendingCells.length
                            ? e.offendingCells
                            : [cell, ...yCells],
                        sliceLabel: e.sliceLabel,
                        accusationIndex,
                        contradictionKind: {
                            _tag: "FailedAccusation",
                            accusationIndex,
                        },
                    });
                }
                throw e;
            }
            if (k !== before && tracer) {
                tracer({
                    cell,
                    value: N,
                    kind: FailedAccusation({ accusationIndex }),
                    dependsOn: yCells,
                });
            }
        }
    });
    return k;
};

/**
 * Multi-accusation pairwise narrowing.
 *
 * Tier-1 (`failedAccusationEliminate`) only sees one accusation at a
 * time. This rule combines failed accusations that share two of three
 * cards to extract deductions Tier 1 can't reach on its own.
 *
 * The constraint a failed accusation imposes is
 *   ¬(case_S ∧ case_W ∧ case_R).
 * Combined with category exclusivity (each category contributes exactly
 * one Y to the case-file row), the following extra rule holds:
 *
 *   For an ordered pair (X, Y) of cards from different categories, let
 *     ZCoverage(X, Y) = { z : (X, Y, z) is a failed accusation, z in
 *                        the third category }.
 *   If case_X = Y AND every still-candidate z (i.e. case_z ≠ N) is in
 *   ZCoverage(X, Y), then case_Y = N.
 *
 * Sketch of why: assume case_Y = Y as well. Then for every accusation
 * (X, Y, z) in the index, Tier 1 forces case_z = N. But category
 * exclusivity demands at least one z in the third category be Y, and
 * the still-candidate z's are exactly the ones Tier 1 would force to
 * N. Contradiction → case_Y must be N.
 *
 * The rule walks all 6 directed (pinned, partner, z-category) shapes —
 * suspects pinned + weapons partner, suspects pinned + rooms partner,
 * weapons pinned + suspects partner, etc. — so any failed-accusation
 * pattern that fits the criterion fires regardless of which category
 * the user happened to deduce first.
 *
 * Complexity: O(|accusations| + |categories|² × max-cards-per-category)
 * per pass. Trivial at Clue's scale (~6 suspects × 6 weapons × 9 rooms,
 * a handful of accusations).
 */
export const failedAccusationPairwiseNarrow = (
    accusations: ReadonlyArray<Accusation>,
    setup: GameSetup,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => {
    if (accusations.length === 0) return knowledge;
    let k = knowledge;
    const caseFile = CaseFileOwner();

    // Index every accusation under all 6 ordered (pinned, partner)
    // pairs. The map's value is a list of (z-card, accusation index)
    // entries — z-card is the third card of the triple, the one the
    // partner would force to N if both pinned and partner were Y.
    type Entry = { readonly z: Card; readonly accusationIndex: number };
    type Key = string;
    const keyOf = (pinned: Card, partner: Card): Key =>
        `${String(pinned)}|${String(partner)}`;
    const index = new Map<Key, Entry[]>();
    const partners = new Map<Key, { readonly pinned: Card; readonly partner: Card }>();

    accusations.forEach((accusation, accusationIndex) => {
        const cards = accusationCards(accusation);
        if (cards.length !== 3) return; // Clue invariant; defensive
        for (let a = 0; a < 3; a++) {
            for (let b = 0; b < 3; b++) {
                if (a === b) continue;
                const c = 3 - a - b;
                const pinned = cards[a]!;
                const partner = cards[b]!;
                const z = cards[c]!;
                const key = keyOf(pinned, partner);
                const entries = index.get(key);
                if (entries === undefined) {
                    index.set(key, [{ z, accusationIndex }]);
                    partners.set(key, { pinned, partner });
                } else {
                    entries.push({ z, accusationIndex });
                }
            }
        }
    });

    for (const [key, entries] of index) {
        const meta = partners.get(key)!;
        const { pinned, partner } = meta;

        // Skip unless the pinned card is Y and the partner is unknown.
        // If partner is already N nothing to add; if partner is Y,
        // Tier 1 + slices will surface the contradiction (or the
        // user's input is over-constrained and they need to resolve
        // it themselves).
        const pinnedCell = Cell(caseFile, pinned);
        const partnerCell = Cell(caseFile, partner);
        if (getCell(k, pinnedCell) !== Y) continue;
        if (getCell(k, partnerCell) !== undefined) continue;

        // Determine the third category from any of the entries' z's
        // (every z in this index entry shares a category by Clue's
        // one-card-per-category-per-accusation invariant).
        const zCategoryId = categoryOfCard(setup.cardSet, entries[0]!.z);
        if (zCategoryId === undefined) continue;
        const zCategoryCards = cardIdsInCategory(setup.cardSet, zCategoryId);
        if (zCategoryCards.length === 0) continue;

        // Build the candidate-z set (cards in the third category whose
        // case-file cell is not yet N) and the covered-z set (the
        // accusation-witnessed z cards).
        const candidates: Card[] = [];
        for (const z of zCategoryCards) {
            if (getCell(k, Cell(caseFile, z)) !== N) candidates.push(z);
        }
        if (candidates.length === 0) {
            // Category exclusivity has already collapsed — let the
            // case-file slice surface the contradiction on its next
            // pass. Don't emit a silent N here.
            continue;
        }
        const covered = new Set<string>();
        const contributingAccusationIndices: number[] = [];
        const seenAccusations = new Set<number>();
        for (const entry of entries) {
            covered.add(String(entry.z));
            if (!seenAccusations.has(entry.accusationIndex)) {
                seenAccusations.add(entry.accusationIndex);
                contributingAccusationIndices.push(entry.accusationIndex);
            }
        }

        // Every candidate must be in the covered set for the rule to
        // fire. (If any candidate isn't covered, the case file might
        // still resolve to that uncovered z, leaving the partner free
        // to be Y.)
        let allCovered = true;
        for (const z of candidates) {
            if (!covered.has(String(z))) {
                allCovered = false;
                break;
            }
        }
        if (!allCovered) continue;

        // Trim the contributing-accusation list to only the ones whose
        // z lies in the candidate set — accusations whose z is already
        // known N didn't actually do work in this firing.
        const candidateSet = new Set<string>(candidates.map(String));
        const usefulAccusations: number[] = [];
        const seenUseful = new Set<number>();
        for (const entry of entries) {
            if (
                candidateSet.has(String(entry.z))
                && !seenUseful.has(entry.accusationIndex)
            ) {
                seenUseful.add(entry.accusationIndex);
                usefulAccusations.push(entry.accusationIndex);
            }
        }
        const accusationIndices = usefulAccusations.length > 0
            ? usefulAccusations
            : contributingAccusationIndices;

        const before = k;
        try {
            k = setCell(k, partnerCell, N);
        } catch (e) {
            if (e instanceof Contradiction) {
                throw new Contradiction({
                    reason: e.reason,
                    offendingCells: e.offendingCells.length
                        ? e.offendingCells
                        : [partnerCell, pinnedCell],
                    sliceLabel: e.sliceLabel,
                    accusationIndex: accusationIndices[0],
                    contradictionKind: {
                        _tag: "FailedAccusationPairwiseNarrowing",
                        accusationIndices,
                    },
                });
            }
            throw e;
        }
        if (k !== before && tracer) {
            // dependsOn is the pinned cell plus every case-file cell in
            // the third category — both the candidate cells (which the
            // rule would have forced to N if partner were Y) and the
            // already-N cells (which is why the candidate set is what
            // it is).
            const dependsOn: Cell[] = [pinnedCell];
            for (const z of zCategoryCards) {
                dependsOn.push(Cell(caseFile, z));
            }
            tracer({
                cell: partnerCell,
                value: N,
                kind: FailedAccusationPairwiseNarrowing({
                    pinnedCard: pinned,
                    accusationIndices,
                }),
                dependsOn,
            });
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
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => {
    const slices = [
        ...cardOwnershipSlices(setup),
        ...playerHandSlices(setup, knowledge),
        ...caseFileCategorySlices(setup),
    ];
    return slices.reduce((k, slice) => applySlice(slice, tracer)(k), knowledge);
};

/**
 * Apply every suggestion-driven rule once.
 *
 * Order matters: `disjointGroupsHandLock` runs after the simpler
 * suggestion rules (so any Ns those rules add are visible) and before
 * `refuterOwnsOneOf` so its newly-set Ns can collapse single-suggestion
 * uncertainty in the same pass.
 */
export const applyDeductionRules = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => pipe(
    knowledge,
    nonRefutersDontHaveSuggestedCards(suggestions, tracer),
    refuterShowedCard(suggestions, tracer),
    disjointGroupsHandLock(setup, suggestions, tracer),
    refuterOwnsOneOf(suggestions, tracer),
);

/**
 * Apply every accusation-driven rule once. The fixed-point loop in
 * `applyAllRules` (and in `deduceWithExplanations`) interleaves these
 * with the slice combinator and suggestion rules so each rule can
 * consume the others' Ys / Ns on the next pass.
 *
 * Order: Tier-1 unit propagation runs first so any (Y, Y, ?) the slice
 * combinator just produced lands a forced N; Tier-2 pairwise narrowing
 * then handles the multi-accusation pigeonhole patterns Tier 1 misses.
 */
export const applyAccusationRules = (
    accusations: ReadonlyArray<Accusation>,
    setup: GameSetup,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => pipe(
    knowledge,
    failedAccusationEliminate(accusations, tracer),
    failedAccusationPairwiseNarrow(accusations, setup, tracer),
);

/**
 * A single pass: apply every consistency, deduction, and accusation
 * rule once. The deducer calls this in a fixed-point loop until
 * nothing changes.
 */
export const applyAllRules = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    accusations: ReadonlyArray<Accusation>,
    tracer?: Tracer,
) => (knowledge: Knowledge): Knowledge => pipe(
    knowledge,
    applyConsistencyRules(setup, tracer),
    applyDeductionRules(setup, suggestions, tracer),
    applyAccusationRules(accusations, setup, tracer),
);
