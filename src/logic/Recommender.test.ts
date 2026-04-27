import { describe, expect, test } from "vitest";
import { CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    Cell,
    emptyKnowledge,
    Knowledge,
    N,
    setCell,
    setHandSize,
    Y,
} from "./Knowledge";
import { expectedInfoGain } from "./EntropyScorer";
import { caseFileCandidatesFor, isAnySlot } from "./Recommender";
import type { AnySlot } from "./Recommender";
import { cardByName } from "./test-utils/CardByName";
import { expectDefined } from "./test-utils/Expect";
import {
    runConsolidate,
    runRecommend,
    runRecommendAction,
} from "./test-utils/RunRecommend";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const suspectsCategory = expectDefined(
    setup.categories.find(c => c.name === "Suspect"),
    "Suspect category",
);
const weaponsCategory = expectDefined(
    setup.categories.find(c => c.name === "Weapon"),
    "Weapon category",
);
const roomsCategory = expectDefined(
    setup.categories.find(c => c.name === "Room"),
    "Room category",
);

const PLUM    = cardByName(setup, "Prof. Plum");
const KNIFE   = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

/**
 * Default 3-player Clue distribution: 21 cards − 3 in the case file
 * = 18 cards / 3 players = 6 each. The info-gain recommender needs
 * hand sizes set so its per-row marginal probability model has
 * non-trivial answers; nearly every test below seeds these on top
 * of `emptyKnowledge`.
 */
const withDefaultHands = (k: Knowledge): Knowledge => {
    let next = k;
    next = setHandSize(next, PlayerOwner(A), 6);
    next = setHandSize(next, PlayerOwner(B), 6);
    next = setHandSize(next, PlayerOwner(C), 6);
    return next;
};
const freshKnowledge = withDefaultHands(emptyKnowledge);

describe("recommendSuggestions (info-gain)", () => {
    test("fresh game returns 5 non-empty recommendations", () => {
        const result = runRecommend(setup, freshKnowledge, A, 5);
        expect(result.recommendations.length).toBe(5);
        for (const rec of result.recommendations) {
            expect(rec.score).toBeGreaterThan(0);
            expect(rec.cards.length).toBe(3); // classic = 3 categories
        }
    });

    test("fully-pinned case file returns no recommendations", () => {
        // Mark every card of every category as N for the case file.
        // cartesianCandidates then yields nothing and we bail out.
        let k = emptyKnowledge;
        for (const c of setup.categories) {
            for (const entry of c.cards) {
                k = setCell(k, Cell(CaseFileOwner(), entry.id), N);
            }
        }
        k = withDefaultHands(k);

        const result = runRecommend(setup, k, A, 5);
        expect(result.recommendations.length).toBe(0);
    });

    test("no recommendations when all other players are known non-refuters", () => {
        // Every card on B and C is N → q=0 for both → only outcome is
        // "nobody refutes" → deducer learns nothing from it → score=0.
        let k = emptyKnowledge;
        for (const c of setup.categories) {
            for (const entry of c.cards) {
                k = setCell(k, Cell(PlayerOwner(B), entry.id), N);
                k = setCell(k, Cell(PlayerOwner(C), entry.id), N);
            }
        }
        const result = runRecommend(setup, k, A, 5);
        expect(result.recommendations.length).toBe(0);
    });

    test("tie-break is stable and deterministic by joined card ids", () => {
        const result = runRecommend(setup, freshKnowledge, A, 5);
        // Fresh board: every triple ties at the top by symmetry. The
        // lexicographic tie-break by joined ids means the recommendations
        // come out in alphabetically-earliest order.
        const joined = result.recommendations.map(r => r.cards.join("|"));
        const sorted = [...joined].sort();
        expect(joined.length).toBe(sorted.length);
        for (let i = 0; i < joined.length; i++) {
            expect(joined[i]).toBe(sorted[i]);
        }
    });

    test("score is the expected reduction in unknown cells (matches outcome math)", () => {
        // Sanity: the score the recommender reports for a triple is
        // identical (within float epsilon) to the value EntropyScorer's
        // pure helper computes for the same triple. Locks the wiring
        // — recommender vs scorer can't drift apart.
        const result = runRecommend(setup, freshKnowledge, A, 1);
        const top = result.recommendations[0];
        expect(top).toBeDefined();
        if (!top) return;
        const directScore = expectedInfoGain(
            setup,
            freshKnowledge,
            [],
            [],
            A,
            top.cards,
        );
        expect(directScore).toBeCloseTo(top.score, 6);
    });
});

describe("consolidateRecommendations", () => {
    const slotAt = (
        row: { readonly cards: ReadonlyArray<unknown> },
        i: number,
    ): AnySlot | undefined => {
        const c = row.cards[i];
        return c !== undefined && typeof c === "object" && c !== null
            && isAnySlot(c as Parameters<typeof isAnySlot>[0])
            ? (c as AnySlot)
            : undefined;
    };

    test("fresh game collapses every category to {kind: 'any'}", () => {
        // 6 × 6 × 9 = 324 tied triples (every score equal by symmetry).
        // Iterative collapse produces a single row with all three slots
        // as `any`.
        const result = runRecommend(setup, freshKnowledge, A, 500);
        const consolidated = runConsolidate(
            setup,
            freshKnowledge,
            result.recommendations,
        );
        expect(consolidated.length).toBe(1);
        const row = consolidated[0]!;
        expect(slotAt(row, 0)).toEqual({ kind: "any" });
        expect(slotAt(row, 1)).toEqual({ kind: "any" });
        expect(slotAt(row, 2)).toEqual({ kind: "any" });
        expect(row.groupSize).toBe(324);
    });

    test("singleton tie-groups never collapse a category slot", () => {
        // Pin one suspect (Plum) as Y in the case file and others as N
        // — only Plum remains a case-file candidate. Every recommendation's
        // suspect slot is Plum (a singleton group), so the suspect slot
        // stays a specific card; weapons and rooms stay open and consolidate
        // to `any`.
        let k = emptyKnowledge;
        for (const entry of suspectsCategory.cards) {
            k = setCell(
                k,
                Cell(CaseFileOwner(), entry.id),
                entry.id === PLUM ? Y : N,
            );
        }
        k = withDefaultHands(k);

        const result = runRecommend(setup, k, A, 500);
        const consolidated = runConsolidate(setup, k, result.recommendations);
        expect(consolidated.length).toBe(1);
        const row = consolidated[0]!;
        // Suspect slot is the single remaining candidate (Plum), not "any".
        expect(row.cards[0]).toBe(PLUM);
        expect(slotAt(row, 1)).toEqual({ kind: "any" });
        expect(slotAt(row, 2)).toEqual({ kind: "any" });
    });

    test("preserves the score on every consolidated row", () => {
        const result = runRecommend(setup, freshKnowledge, A, 500);
        const consolidated = runConsolidate(
            setup,
            freshKnowledge,
            result.recommendations,
        );
        for (const row of consolidated) {
            expect(row.score).toBeGreaterThan(0);
            expect(typeof row.score).toBe("number");
        }
    });
});

describe("recommendAction", () => {
    /**
     * Pin every card in a category to N for the case file *except*
     * the named card, which is set Y. Used to construct the
     * "fully pinned" case file states the action recommender keys on.
     */
    const pinCategory = (
        k: Knowledge,
        category: typeof suspectsCategory,
        keep: ReturnType<typeof cardByName>,
    ) => {
        let next = k;
        for (const entry of category.cards) {
            const cell = Cell(CaseFileOwner(), entry.id);
            next = setCell(next, cell, entry.id === keep ? Y : N);
        }
        return next;
    };

    test("Accuse — fully solved case file returns the deduced triple", () => {
        let k = emptyKnowledge;
        k = pinCategory(k, suspectsCategory, PLUM);
        k = pinCategory(k, weaponsCategory, KNIFE);
        k = pinCategory(k, roomsCategory, KITCHEN);
        // No handSizes needed — the Accuse branch fires before any
        // info-gain scoring.
        const action = runRecommendAction(setup, k, A);
        expect(action._tag).toBe("Accuse");
        if (action._tag !== "Accuse") return;
        expect(action.accuser).toBe(A);
        expect(action.cards).toHaveLength(3);
        // Cards come back in setup-category order (Suspect, Weapon, Room).
        expect(action.cards[0]).toBe(PLUM);
        expect(action.cards[1]).toBe(KNIFE);
        expect(action.cards[2]).toBe(KITCHEN);
    });

    test("NearlySolved — two pinned + one open with exactly 2 candidates", () => {
        let k = emptyKnowledge;
        k = pinCategory(k, suspectsCategory, PLUM);
        k = pinCategory(k, weaponsCategory, KNIFE);
        // Rooms category: pin all but two (Kitchen + Conservatory) as N
        // — neither is Y yet, so the category is still "open" with 2
        // candidates.
        for (const entry of roomsCategory.cards) {
            if (entry.name === "Kitchen") continue;
            if (entry.name === "Conservatory") continue;
            k = setCell(k, Cell(CaseFileOwner(), entry.id), N);
        }
        k = withDefaultHands(k);

        const action = runRecommendAction(setup, k, A);
        expect(action._tag).toBe("NearlySolved");
        if (action._tag !== "NearlySolved") return;
        expect(action.openCategory).toBe(roomsCategory.id);
        expect(action.candidates).toHaveLength(2);
        // Suggestions list is non-empty so the user can probe the
        // remaining ambiguity.
        expect(
            action.suggestions.recommendations.length,
        ).toBeGreaterThan(0);
    });

    test("Suggest — fresh game with hand sizes falls into the regular ranking", () => {
        const action = runRecommendAction(setup, freshKnowledge, A);
        expect(action._tag).toBe("Suggest");
        if (action._tag !== "Suggest") return;
        expect(action.suggester).toBe(A);
        expect(action.suggestions.recommendations.length).toBeGreaterThan(0);
    });

    test("Suggest — third category at 1 candidate is NOT NearlySolved", () => {
        // Pin every weapon as N except KNIFE (still unknown for case
        // file). Suspects category fully solved on PLUM. Rooms still
        // wide open. The "open" set then is weapons+rooms — 2 open
        // categories, so this is plain Suggest.
        let k = emptyKnowledge;
        k = pinCategory(k, suspectsCategory, PLUM);
        for (const entry of weaponsCategory.cards) {
            if (entry.id === KNIFE) continue;
            k = setCell(k, Cell(CaseFileOwner(), entry.id), N);
        }
        k = withDefaultHands(k);
        const action = runRecommendAction(setup, k, A);
        // openCategories.length === 2 (weapons + rooms) → falls into Suggest.
        expect(action._tag).toBe("Suggest");
    });

    test("Suggest — open category at 1 candidate falls into Suggest, not NearlySolved", () => {
        // 2 categories solved + the third has exactly 1 case-file
        // candidate but no Y yet → openCategories.length === 1 with
        // candidates.length === 1, not 2. The rule explicitly requires
        // exactly 2.
        let k = emptyKnowledge;
        k = pinCategory(k, suspectsCategory, PLUM);
        k = pinCategory(k, weaponsCategory, KNIFE);
        for (const entry of roomsCategory.cards) {
            if (entry.id === KITCHEN) continue;
            k = setCell(k, Cell(CaseFileOwner(), entry.id), N);
        }
        k = withDefaultHands(k);
        const action = runRecommendAction(setup, k, A);
        expect(action._tag).toBe("Suggest");
    });

    test("Nothing — no probes available falls into Nothing", () => {
        // Mark every card on every other player's row as N. With no
        // possible refuter for any candidate, the only outcome is
        // "nobody refutes" → 0 info gain → no recommendations →
        // Nothing.
        let k = emptyKnowledge;
        for (const c of setup.categories) {
            for (const entry of c.cards) {
                k = setCell(k, Cell(PlayerOwner(B), entry.id), N);
                k = setCell(k, Cell(PlayerOwner(C), entry.id), N);
            }
        }
        const action = runRecommendAction(setup, k, A);
        expect(action._tag).toBe("Nothing");
        if (action._tag !== "Nothing") return;
        expect(action.suggester).toBe(A);
    });

    test("Empty knowledge with handSizes set — non-empty Suggest result", () => {
        const action = runRecommendAction(setup, freshKnowledge, A);
        expect(action._tag).toBe("Suggest");
        if (action._tag !== "Suggest") return;
        // Top recommendation has one card per category and non-zero scores.
        const top = action.suggestions.recommendations[0];
        expect(top).toBeDefined();
        if (!top) return;
        expect(top.cards).toHaveLength(setup.categories.length);
        expect(top.score).toBeGreaterThan(0);
        expect(top.suggester).toBe(A);
    });
});

describe("caseFileCandidatesFor", () => {
    test("returns all category cards on empty knowledge", () => {
        const suspects = caseFileCandidatesFor(
            setup,
            emptyKnowledge,
            suspectsCategory.id,
        );
        expect(suspects.length).toBe(suspectsCategory.cards.length);
    });

    test("excludes cards marked N for the case file", () => {
        const missScarlet = cardByName(setup, "Miss Scarlet");
        const k = setCell(
            emptyKnowledge,
            Cell(CaseFileOwner(), missScarlet),
            N,
        );
        const suspects = caseFileCandidatesFor(
            setup,
            k,
            suspectsCategory.id,
        );
        expect(suspects.length).toBe(suspectsCategory.cards.length - 1);
        expect(suspects.map(String)).not.toContain(String(missScarlet));
    });
});
