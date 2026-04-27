import { describe, expect, test } from "vitest";
import { CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    Cell,
    emptyKnowledge,
    N,
    setCell,
    Y,
} from "./Knowledge";
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

describe("recommendSuggestions", () => {
    test("fresh game returns 5 non-empty recommendations", () => {
        const result = runRecommend(setup, emptyKnowledge, A, 5);
        expect(result.recommendations.length).toBe(5);
        for (const rec of result.recommendations) {
            expect(rec.score).toBeGreaterThan(0);
            expect(rec.cellInfoScore).toBeGreaterThan(0);
            expect(rec.caseFileOpennessScore).toBeGreaterThan(0);
            expect(rec.refuterUncertaintyScore).toBeGreaterThan(0);
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

        const result = runRecommend(setup, k, A, 5);
        expect(result.recommendations.length).toBe(0);
    });

    test("recommendations prefer cards with more case-file candidates", () => {
        // Narrow the suspects category to just 2 case-file candidates
        // (pin 4 of 6 as N). Rooms/weapons stay fully open. Every
        // recommendation's first card must now be one of the two
        // remaining suspect ids.
        let k = emptyKnowledge;
        for (const entry of suspectsCategory.cards.slice(0, 4)) {
            k = setCell(k, Cell(CaseFileOwner(), entry.id), N);
        }
        const result = runRecommend(setup, k, A, 50);
        const allowed = new Set(
            suspectsCategory.cards.slice(4).map(e => String(e.id)),
        );
        for (const rec of result.recommendations) {
            expect(allowed.has(String(rec.cards[0]))).toBe(true);
        }
    });

    test("refuter-uncertainty tiebreak: 2 possible refuters beats 1", () => {
        // Mark Cho as N on a specific (suspect, weapon, room) triple.
        // Any suggestion using that exact triple has refuterUncertainty=1
        // (only Bob could refute); other suggestions have uncertainty=2.
        // The constrained triple should not appear in the top 5.
        const badSuspect = cardByName(setup, "Miss Scarlet");
        const badWeapon = cardByName(setup, "Knife");
        const badRoom = cardByName(setup, "Kitchen");
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(C), badSuspect), N);
        k = setCell(k, Cell(PlayerOwner(C), badWeapon), N);
        k = setCell(k, Cell(PlayerOwner(C), badRoom), N);

        const result = runRecommend(setup, k, A, 50);
        const badIdx = result.recommendations.findIndex(
            r =>
                String(r.cards[0]) === String(badSuspect) &&
                String(r.cards[1]) === String(badWeapon) &&
                String(r.cards[2]) === String(badRoom),
        );
        expect(badIdx === -1 || badIdx >= 5).toBe(true);
    });

    test("no recommendations when all other players are known non-refuters", () => {
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
        const result = runRecommend(setup, emptyKnowledge, A, 5);
        // Fresh board: every triple ties at the top. The lexicographic
        // tie-break by joined ids means result[0] is the
        // alphabetically-earliest joined string.
        const joined = result.recommendations.map(r => r.cards.join("|"));
        const sorted = [...joined].sort();
        expect(joined.length).toBe(sorted.length);
        for (let i = 0; i < joined.length; i++) {
            expect(joined[i]).toBe(sorted[i]);
        }
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
        // 6 × 6 × 9 = 324 tied triples. Iterative collapse produces
        // a single row with all three slots as `any`.
        const result = runRecommend(setup, emptyKnowledge, A, 500);
        const consolidated = runConsolidate(
            setup,
            emptyKnowledge,
            result.recommendations,
        );
        expect(consolidated.length).toBe(1);
        const row = consolidated[0]!;
        expect(slotAt(row, 0)).toEqual({ kind: "any" });
        expect(slotAt(row, 1)).toEqual({ kind: "any" });
        expect(slotAt(row, 2)).toEqual({ kind: "any" });
        expect(row.groupSize).toBe(324);
    });

    test("fresh game prefers `any` over `anyYouDontOwn` when both targets equal the full candidate set (broadest wins)", () => {
        // Within case-file candidates, suggester-owned cells are
        // unknown (fresh game), so `anyYouDontOwn` has an empty target
        // and doesn't apply. The picker must still emit `{kind:"any"}`
        // and never `{kind:"anyYouDontOwn"}` even when its target
        // eventually equals the full candidate set.
        const result = runRecommend(setup, emptyKnowledge, A, 500);
        const consolidated = runConsolidate(
            setup,
            emptyKnowledge,
            result.recommendations,
        );
        for (const row of consolidated) {
            for (let i = 0; i < row.cards.length; i++) {
                const s = slotAt(row, i);
                if (s !== undefined) {
                    expect(s.kind).not.toBe("anyYouDontOwn");
                    expect(s.kind).not.toBe("anyYouDontKnow");
                }
            }
        }
    });

    test("collapses to {kind: 'anyYouDontKnow'} when one candidate is known in the case file and the rest are undef", () => {
        // Pin Miss Scarlet as the case-file answer (Y), mark Mustard &
        // Mrs. White as N (removed from candidates). The remaining 3
        // suspects (Green, Peacock, Plum) stay undef. Case-file
        // candidates = {Scarlet, Green, Peacock, Plum} (size 4).
        //
        // Also mark (B, Scarlet) = N and (C, Scarlet) = N so Scarlet
        // contributes 0 to cellInfoScore while Green/Peacock/Plum each
        // contribute 2. This splits Scarlet-containing triples into a
        // lower-score tier, leaving triples in the higher-score tier
        // with distinct suspect values {Green, Peacock, Plum} = the
        // `anyYouDontKnow` target set.
        let k = emptyKnowledge;
        const scarlet = cardByName(setup, "Miss Scarlet");
        const mustard = cardByName(setup, "Col. Mustard");
        const white = cardByName(setup, "Mrs. White");
        k = setCell(k, Cell(CaseFileOwner(), mustard), N);
        k = setCell(k, Cell(CaseFileOwner(), white), N);
        k = setCell(k, Cell(CaseFileOwner(), scarlet), "Y");
        k = setCell(k, Cell(PlayerOwner(B), scarlet), N);
        k = setCell(k, Cell(PlayerOwner(C), scarlet), N);

        const result = runRecommend(setup, k, A, 500);
        const consolidated = runConsolidate(
            setup,
            k,
            result.recommendations,
        );

        const withDontKnow = consolidated.filter(
            r => slotAt(r, 0)?.kind === "anyYouDontKnow",
        );
        expect(withDontKnow.length).toBe(1);
    });

    test("collapses to {kind: 'anyNotOwnedBy', player} when tie-group matches known-N cards for that player", () => {
        // Mark Bob = N on 3 of 6 suspects. Those triples have lower
        // cellInfoScore (1 less unknown cell in Bob's row per trip) so
        // they form their own score tier. Within that tier, the
        // distinct suspect values are exactly {Scarlet, Mustard, White}
        // — the `anyNotOwnedBy(Bob)` target, a strict subset of the 6
        // case-file candidates. `any` doesn't match (6 ≠ 3);
        // `anyNotOwnedBy(Bob)` does.
        let k = emptyKnowledge;
        const scarlet = cardByName(setup, "Miss Scarlet");
        const mustard = cardByName(setup, "Col. Mustard");
        const white = cardByName(setup, "Mrs. White");
        k = setCell(k, Cell(PlayerOwner(B), scarlet), N);
        k = setCell(k, Cell(PlayerOwner(B), mustard), N);
        k = setCell(k, Cell(PlayerOwner(B), white), N);

        const result = runRecommend(setup, k, A, 500);
        const consolidated = runConsolidate(
            setup,
            k,
            result.recommendations,
        );
        const notOwnedRow = consolidated.find(r => {
            const s = slotAt(r, 0);
            return s?.kind === "anyNotOwnedBy" && s.player === B;
        });
        expect(notOwnedRow).toBeDefined();
    });

    test("singleton tie-groups never collapse", () => {
        // From the known-case-file test, Miss Scarlet ends up in its
        // own score tier (lower cellInfoScore — 0 for the suspect
        // cell). That tier has only one suspect (Scarlet), so the
        // suspect slot stays a specific card; weapons and rooms still
        // collapse to `any`.
        let k = emptyKnowledge;
        const scarlet = cardByName(setup, "Miss Scarlet");
        const mustard = cardByName(setup, "Col. Mustard");
        const white = cardByName(setup, "Mrs. White");
        k = setCell(k, Cell(CaseFileOwner(), mustard), N);
        k = setCell(k, Cell(CaseFileOwner(), white), N);
        k = setCell(k, Cell(CaseFileOwner(), scarlet), "Y");
        k = setCell(k, Cell(PlayerOwner(B), scarlet), N);
        k = setCell(k, Cell(PlayerOwner(C), scarlet), N);

        const result = runRecommend(setup, k, A, 500);
        const consolidated = runConsolidate(
            setup,
            k,
            result.recommendations,
        );
        const scarletRow = consolidated.find(r => r.cards[0] === scarlet);
        expect(scarletRow).toBeDefined();
        // The other two slots for this row should still collapse —
        // their distinct values cover all candidates in those
        // categories, so `any` matches.
        expect(slotAt(scarletRow!, 1)).toEqual({ kind: "any" });
        expect(slotAt(scarletRow!, 2)).toEqual({ kind: "any" });
    });
});

describe("recommendAction", () => {
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
     * Pin every card in a category to N for the case file *except*
     * the named card, which is set Y. Used to construct the
     * "fully pinned" case file states the action recommender keys on.
     */
    const pinCategory = (
        k: ReturnType<typeof setCell>,
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

    test("Suggest — partial knowledge falls into the regular ranking", () => {
        const action = runRecommendAction(setup, emptyKnowledge, A);
        expect(action._tag).toBe("Suggest");
        if (action._tag !== "Suggest") return;
        expect(action.suggester).toBe(A);
        expect(action.suggestions.recommendations.length).toBeGreaterThan(0);
    });

    test("Suggest — third category at 1 candidate is NOT NearlySolved (still open == not yet pinned to Y)", () => {
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
        const action = runRecommendAction(setup, k, A);
        // openCategories.length === 2 (weapons + rooms) → falls into Suggest.
        expect(action._tag).toBe("Suggest");
    });

    test("NearlySolved — open category at 1 candidate falls into Suggest, not NearlySolved", () => {
        // 2 categories solved + the third has exactly 1 case-file
        // candidate but no Y yet → openCategories.length === 1 with
        // candidates.length === 1, not 2. The rule explicitly requires
        // exactly 2.
        let k = emptyKnowledge;
        k = pinCategory(k, suspectsCategory, PLUM);
        k = pinCategory(k, weaponsCategory, KNIFE);
        // Rooms: pin every room as N except KITCHEN, which stays
        // unknown.
        for (const entry of roomsCategory.cards) {
            if (entry.id === KITCHEN) continue;
            k = setCell(k, Cell(CaseFileOwner(), entry.id), N);
        }
        // Now KITCHEN is the only candidate but not yet Y → open
        // category has 1 candidate. recommendAction treats this as
        // Suggest (the consistency slice will close it on the next
        // deducer pass, but the action recommender doesn't peek
        // forward).
        const action = runRecommendAction(setup, k, A);
        expect(action._tag).toBe("Suggest");
    });

    test("Nothing — no probes available falls into Nothing", () => {
        // Construct a state where every other-player row is fully N
        // for every card — `cellInfoScore` is 0 for every triple, so
        // recommendSuggestions returns nothing and the action falls
        // into Nothing.
        let k = emptyKnowledge;
        for (const entry of suspectsCategory.cards) {
            k = setCell(k, Cell(PlayerOwner(B), entry.id), N);
            k = setCell(k, Cell(PlayerOwner(C), entry.id), N);
        }
        for (const entry of weaponsCategory.cards) {
            k = setCell(k, Cell(PlayerOwner(B), entry.id), N);
            k = setCell(k, Cell(PlayerOwner(C), entry.id), N);
        }
        for (const entry of roomsCategory.cards) {
            k = setCell(k, Cell(PlayerOwner(B), entry.id), N);
            k = setCell(k, Cell(PlayerOwner(C), entry.id), N);
        }
        const action = runRecommendAction(setup, k, A);
        expect(action._tag).toBe("Nothing");
        if (action._tag !== "Nothing") return;
        expect(action.suggester).toBe(A);
    });

    test("Empty knowledge — yields a non-empty Suggest result", () => {
        const action = runRecommendAction(setup, emptyKnowledge, A);
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
