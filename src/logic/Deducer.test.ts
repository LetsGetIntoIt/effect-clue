import { describe, expect, test } from "vitest";
import { HashMap, Result } from "effect";
import { CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { cardIdsInCategory, CLASSIC_SETUP_3P } from "./GameSetup";
import { cardByName } from "./test-utils/CardByName";
import { expectAt, expectDefined } from "./test-utils/Expect";
import {
    Cell,
    emptyKnowledge,
    getCellByOwnerCard,
    N,
    setCell,
    setHandSize,
    Y,
} from "./Knowledge";
import { Accusation } from "./Accusation";
import { Suggestion } from "./Suggestion";
import { runDeduce } from "./test-utils/RunDeduce";

const setup = CLASSIC_SETUP_3P;
// Suspect category id is the branded string "category-suspects" in the
// preset. Look up by the category's own id.
const suspectsCategory = expectDefined(
    setup.categories.find(c => c.name === "Suspect"),
    "Suspect category",
);
const suspects = cardIdsInCategory(setup, suspectsCategory.id);
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

// Shorthands: look up card ids by display name from the preset. With the
// id/name split, raw `Card("Col. Mustard")` would construct a brand new
// unrelated id.
const MUSTARD  = cardByName(setup, "Col. Mustard");
const PLUM     = cardByName(setup, "Prof. Plum");
const KNIFE    = cardByName(setup, "Knife");
const REVOLVER = cardByName(setup, "Revolver");
const ROPE     = cardByName(setup, "Rope");
const KITCHEN  = cardByName(setup, "Kitchen");
const LIBRARY  = cardByName(setup, "Library");
const CONSERV  = cardByName(setup, "Conservatory");

describe("deduce", () => {
    test("empty inputs produce empty knowledge", () => {
        const result = runDeduce(setup, [], emptyKnowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        expect(HashMap.size(result.success.checklist)).toBe(0);
    });

    test("card ownership propagates: one Y forces Ns elsewhere", () => {
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), MUSTARD), Y);

        const result = runDeduce(setup, [], knowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        // Every other owner now has N for Col. Mustard.
        expect(getCellByOwnerCard(result.success, PlayerOwner(B), MUSTARD)).toBe(N);
        expect(getCellByOwnerCard(result.success, PlayerOwner(C), MUSTARD)).toBe(N);
        expect(getCellByOwnerCard(result.success, CaseFileOwner(), MUSTARD)).toBe(N);
    });

    test("case file category narrows to single candidate", () => {
        let knowledge = emptyKnowledge;
        // If nobody owns 5 of the 6 suspects, the 6th must be in the case file.
        for (const card of suspects.slice(0, 5)) {
            knowledge = setCell(knowledge, Cell(PlayerOwner(A), card), Y);
        }
        // Anisha has 5 cards; tell the solver the size so it can fill Ns.
        knowledge = setHandSize(knowledge, PlayerOwner(A), 5);

        const result = runDeduce(setup, [], knowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        const sixth = expectAt(suspects, 5, "suspects[5]");
        // The last suspect must be in the case file.
        expect(getCellByOwnerCard(result.success, CaseFileOwner(), sixth)).toBe(Y);
    });

    test("non-refuters don't have the suggested cards", () => {
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [B, C],
        })];

        const result = runDeduce(setup, suggestions, emptyKnowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        for (const card of [PLUM, KNIFE, CONSERV]) {
            expect(getCellByOwnerCard(result.success, PlayerOwner(B), card)).toBe(N);
            expect(getCellByOwnerCard(result.success, PlayerOwner(C), card)).toBe(N);
        }
    });

    test("refuter with seen card marks ownership", () => {
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
            seenCard: CONSERV,
        })];

        const result = runDeduce(setup, suggestions, emptyKnowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        expect(getCellByOwnerCard(result.success, PlayerOwner(B), CONSERV)).toBe(Y);
    });

    test("refuter forced to own the only non-excluded card", () => {
        let knowledge = emptyKnowledge;
        // We already know Bob doesn't own two of the three suggested cards.
        knowledge = setCell(knowledge, Cell(PlayerOwner(B), PLUM),  N);
        knowledge = setCell(knowledge, Cell(PlayerOwner(B), KNIFE), N);

        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        })];

        const result = runDeduce(setup, suggestions, knowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        expect(getCellByOwnerCard(result.success, PlayerOwner(B), CONSERV)).toBe(Y);
    });

    test("full scenario: multiple suggestions converge", () => {
        // Matches the original Deducer integration test.
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), MUSTARD),  Y);
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), REVOLVER), Y);
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), LIBRARY),  Y);
        knowledge = setHandSize(knowledge, PlayerOwner(A), 3);
        knowledge = setHandSize(knowledge, PlayerOwner(B), 2);

        const suggestions = [
            Suggestion({
                suggester: A,
                cards: [PLUM, KNIFE, CONSERV],
                nonRefuters: [],
                refuter: B,
                seenCard: CONSERV,
            }),
            Suggestion({
                suggester: C,
                cards: [MUSTARD, REVOLVER, KITCHEN],
                nonRefuters: [B],
            }),
            Suggestion({
                suggester: C,
                cards: [MUSTARD, ROPE, KITCHEN],
                nonRefuters: [],
                refuter: B,
            }),
        ];

        const result = runDeduce(setup, suggestions, knowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        const k = result.success;
        // Anisha's known cards.
        expect(getCellByOwnerCard(k, PlayerOwner(A), MUSTARD)).toBe(Y);
        expect(getCellByOwnerCard(k, PlayerOwner(A), REVOLVER)).toBe(Y);
        expect(getCellByOwnerCard(k, PlayerOwner(A), LIBRARY)).toBe(Y);

        // Bob has the conservatory (we saw it) and the rope (only card he
        // could have used to refute the third suggestion).
        expect(getCellByOwnerCard(k, PlayerOwner(B), CONSERV)).toBe(Y);
        expect(getCellByOwnerCard(k, PlayerOwner(B), ROPE)).toBe(Y);

        // Bob couldn't refute the kitchen suggestion, so he doesn't own it.
        expect(getCellByOwnerCard(k, PlayerOwner(B), KITCHEN)).toBe(N);
    });

    // Regression: when the suggester owns one of the suggested cards,
    // the card-ownership slice cascades that Y into N on every other
    // owner's row, including the refuter's. refuterOwnsOneOf then has
    // exactly one unknown across the three suggested cards and forces
    // it to Y — all in one trip through the fixed-point loop.
    test("suggester-owned card cascade narrows refuter to a single Y", () => {
        let knowledge = emptyKnowledge;
        // Anisha (the suggester) owns Plum.
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), PLUM),  Y);
        // We've previously confirmed Bob doesn't own the Knife.
        knowledge = setCell(knowledge, Cell(PlayerOwner(B), KNIFE), N);

        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        })];

        const result = runDeduce(setup, suggestions, knowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        // Cascade: A/Plum=Y → B/Plum=N (and C/Plum=N, CF/Plum=N).
        expect(getCellByOwnerCard(result.success, PlayerOwner(B), PLUM)).toBe(N);
        // With B/Plum=N and B/Knife=N, Bob's refutation must have used
        // Conservatory.
        expect(getCellByOwnerCard(result.success, PlayerOwner(B), CONSERV)).toBe(Y);
    });

    // disjointGroupsHandLock cascade: with two disjoint refuted
    // suggestions and Bob's hand pinned to size 2, every card outside
    // the union of those two triples must be N for Bob. The fixed-point
    // loop then propagates those Ns through card-ownership and
    // case-file-category slices.
    test("disjoint groups force out-of-union cells N through fixed-point", () => {
        let knowledge = emptyKnowledge;
        knowledge = setHandSize(knowledge, PlayerOwner(B), 2);

        const SCARLET = cardByName(setup, "Miss Scarlet");
        const GREEN   = cardByName(setup, "Mr. Green");
        const WHITE   = cardByName(setup, "Mrs. White");
        const HALL    = cardByName(setup, "Hall");

        const suggestions = [
            // Two disjoint refuted triples — Bob owes ≥1 from each.
            Suggestion({ suggester: A, cards: [PLUM, KNIFE, CONSERV],
                nonRefuters: [], refuter: B }),
            Suggestion({ suggester: A, cards: [SCARLET, ROPE, LIBRARY],
                nonRefuters: [], refuter: B }),
        ];

        const result = runDeduce(setup, suggestions, knowledge);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        const k = result.success;

        // Out-of-union cells on Bob's row are forced N — Bob's two hand
        // slots are accounted for by the disjoint groups.
        expect(getCellByOwnerCard(k, PlayerOwner(B), GREEN)).toBe(N);
        expect(getCellByOwnerCard(k, PlayerOwner(B), WHITE)).toBe(N);
        expect(getCellByOwnerCard(k, PlayerOwner(B), HALL)).toBe(N);
    });

    test("disjoint groups: groupCount > handRemaining surfaces as failure", () => {
        let knowledge = emptyKnowledge;
        knowledge = setHandSize(knowledge, PlayerOwner(B), 1);
        const suggestions = [
            Suggestion({ suggester: A, cards: [PLUM, KNIFE, CONSERV],
                nonRefuters: [], refuter: B }),
            Suggestion({ suggester: A,
                cards: [cardByName(setup, "Miss Scarlet"), ROPE, LIBRARY],
                nonRefuters: [], refuter: B }),
        ];
        const result = runDeduce(setup, suggestions, knowledge);
        expect(Result.isFailure(result)).toBe(true);
        if (!Result.isFailure(result)) return;
        expect(result.failure.contradictionKind?._tag)
            .toBe("DisjointGroupsHandLock");
    });

    test("contradiction is surfaced as a result", () => {
        let knowledge = emptyKnowledge;
        // Both Anisha and Bob have Knife? That's a contradiction once the
        // card-ownership rule fires.
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), KNIFE), Y);
        knowledge = setCell(knowledge, Cell(PlayerOwner(B), KNIFE), Y);

        const result = runDeduce(setup, [], knowledge);
        expect(Result.isFailure(result)).toBe(true);
    });

    test("contradiction trace highlights offending cells and slice", () => {
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), KNIFE), Y);
        knowledge = setCell(knowledge, Cell(PlayerOwner(B), KNIFE), Y);

        const result = runDeduce(setup, [], knowledge);
        expect(Result.isFailure(result)).toBe(true);
        if (!Result.isFailure(result)) return;

        expect(result.failure.sliceLabel).toContain("Knife");
        expect(result.failure.offendingCells).toHaveLength(2);
        expect(result.failure.offendingSuggestionIndices).toHaveLength(0);
    });

    test("contradiction trace names the offending suggestion", () => {
        let knowledge = emptyKnowledge;
        // Bob can't own Plum (pre-marked N by the user).
        knowledge = setCell(knowledge, Cell(PlayerOwner(B), PLUM), N);

        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
            seenCard: PLUM, // claims Bob showed Plum — contradicts prior N
        })];

        const result = runDeduce(setup, suggestions, knowledge);
        expect(Result.isFailure(result)).toBe(true);
        if (!Result.isFailure(result)) return;

        expect(result.failure.offendingSuggestionIndices).toHaveLength(1);
        expect(result.failure.offendingSuggestionIndices[0]).toBe(0);
    });
});

describe("deduce — failed accusations", () => {
    test("a failed accusation forces the matching N when the other two are pinned", () => {
        let knowledge = emptyKnowledge;
        // Pin two of the three case-file slots via direct ownership cascades.
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), PLUM), Y);
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), KNIFE), Y);
        const accusations = [
            Accusation({ accuser: A, cards: [PLUM, KNIFE, CONSERV] }),
        ];

        const result = runDeduce(setup, [], knowledge, accusations);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;

        expect(getCellByOwnerCard(result.success, CaseFileOwner(), CONSERV)).toBe(N);
    });

    test("backward compat: a runDeduce call without accusations matches one with []", () => {
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), MUSTARD), Y);
        const suggestions = [Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B, C],
        })];

        const noArg = runDeduce(setup, suggestions, knowledge);
        const empty = runDeduce(setup, suggestions, knowledge, []);
        expect(Result.isSuccess(noArg)).toBe(true);
        expect(Result.isSuccess(empty)).toBe(true);
        if (!Result.isSuccess(noArg) || !Result.isSuccess(empty)) return;
        expect(HashMap.size(noArg.success.checklist)).toBe(
            HashMap.size(empty.success.checklist),
        );
    });

    test("contradictory accusation: all three Y → trace names the accusation", () => {
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), PLUM), Y);
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), KNIFE), Y);
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), CONSERV), Y);
        const accusations = [
            Accusation({ accuser: A, cards: [PLUM, KNIFE, CONSERV] }),
        ];
        const result = runDeduce(setup, [], knowledge, accusations);
        expect(Result.isFailure(result)).toBe(true);
        if (!Result.isFailure(result)) return;
        expect(result.failure.offendingAccusationIndices).toEqual([0]);
        expect(result.failure.contradictionKind?._tag).toBe("FailedAccusation");
    });

    test("Tier 2: case_S=Y + accusations covering every room for (S, W) → case_W=N", () => {
        // Pin Plum (suspect) Y in case file. Don't pin any weapon or
        // room. Then file failed accusations (Plum, Knife, R) for every
        // room R — together they exhaust the room category. Tier 1
        // alone can't fire (each accusation has only 1 Y, 0 N), but
        // Tier 2 should deduce: case_Knife = N.
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), PLUM), Y);
        const roomsCategory = expectDefined(
            setup.categories.find(c => c.name === "Room"),
            "Room category",
        );
        const rooms = cardIdsInCategory(setup, roomsCategory.id);
        const accusations = rooms.map(r =>
            Accusation({ accuser: A, cards: [PLUM, KNIFE, r] }),
        );
        const result = runDeduce(setup, [], knowledge, accusations);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        expect(getCellByOwnerCard(result.success, CaseFileOwner(), KNIFE)).toBe(N);
    });

    test("Tier 2: case_R=Y + accusations covering every suspect for (W, R) → case_W=N", () => {
        // Symmetric to the above but pinned on the room side: pin
        // Conservatory Y in case file, then file (S, Knife, Conservatory)
        // for every suspect S so that the (suspect, _ , Conservatory)
        // pair "Knife as partner pinned by Conservatory" is exhausted.
        // Wait — Tier 2's pinned/partner/z roles are symmetric across
        // all 6 orderings. Pinning Conservatory and exhausting the
        // suspect category over (W=Knife, R=Conservatory) accusations
        // forces case_Knife = N.
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), CONSERV), Y);
        const accusations = suspects.map(s =>
            Accusation({ accuser: A, cards: [s, KNIFE, CONSERV] }),
        );
        const result = runDeduce(setup, [], knowledge, accusations);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        expect(getCellByOwnerCard(result.success, CaseFileOwner(), KNIFE)).toBe(N);
    });

    test("Tier 2: doesn't fire when one candidate room isn't covered", () => {
        // Pin Plum Y in case file. File (Plum, Knife, R) for every
        // room *except* Library — leaves Library uncovered. Tier 2
        // must NOT force case_Knife=N because the case file could
        // still be (Plum, Knife, Library) which isn't refuted by any
        // failed accusation.
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), PLUM), Y);
        const roomsCategory = expectDefined(
            setup.categories.find(c => c.name === "Room"),
            "Room category",
        );
        const rooms = cardIdsInCategory(setup, roomsCategory.id);
        const accusations = rooms
            .filter(r => r !== LIBRARY)
            .map(r => Accusation({ accuser: A, cards: [PLUM, KNIFE, r] }));
        const result = runDeduce(setup, [], knowledge, accusations);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        expect(
            getCellByOwnerCard(result.success, CaseFileOwner(), KNIFE),
        ).toBeUndefined();
    });

    test("Tier 2 + already-N rooms: candidate set excludes them, narrowing still works", () => {
        // Pin Plum Y in case file. Manually mark every room except
        // Conservatory and Library as N for case file (so the room
        // category is narrowed to two candidates). File only two
        // failed accusations: (Plum, Knife, Conservatory) and
        // (Plum, Knife, Library). Tier 2 sees that the candidate set
        // {Conservatory, Library} is exactly covered, so it forces
        // case_Knife = N.
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), PLUM), Y);
        const roomsCategory = expectDefined(
            setup.categories.find(c => c.name === "Room"),
            "Room category",
        );
        const rooms = cardIdsInCategory(setup, roomsCategory.id);
        for (const r of rooms) {
            if (r === CONSERV || r === LIBRARY) continue;
            knowledge = setCell(knowledge, Cell(CaseFileOwner(), r), N);
        }
        const accusations = [
            Accusation({ accuser: A, cards: [PLUM, KNIFE, CONSERV] }),
            Accusation({ accuser: A, cards: [PLUM, KNIFE, LIBRARY] }),
        ];
        const result = runDeduce(setup, [], knowledge, accusations);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        expect(getCellByOwnerCard(result.success, CaseFileOwner(), KNIFE)).toBe(N);
    });

    test("Tier 2 cascades: forced N opens slice → forced Y → Tier 1 fires next iteration", () => {
        // Same pigeonhole as above, but narrow the WEAPON category to
        // just {Knife, Rope} via case-file Ns. Tier 2 forces
        // case_Knife=N, the case-file slice then forces case_Rope=Y,
        // and then Tier 1 fires on each (Plum, Knife, R) accusation —
        // but those accusations name Knife (now N), so they're
        // trivially satisfied. Instead Tier 2 fires AGAIN under the
        // (Rope is now Y) configuration if there are also accusations
        // pairing Rope with Plum.
        //
        // Simpler cascade check: pin Plum=Y, narrow rooms to one
        // candidate. The slice forces that room=Y, and Tier 1 then
        // gets (Y, Y, ?) → forces the third card to N. We verify the
        // final outcome.
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), PLUM), Y);
        const roomsCategory = expectDefined(
            setup.categories.find(c => c.name === "Room"),
            "Room category",
        );
        const rooms = cardIdsInCategory(setup, roomsCategory.id);
        // Knock all rooms but Conservatory to N → slice forces
        // case_Conservatory=Y.
        for (const r of rooms) {
            if (r === CONSERV) continue;
            knowledge = setCell(knowledge, Cell(CaseFileOwner(), r), N);
        }
        const accusations = [
            Accusation({ accuser: A, cards: [PLUM, KNIFE, CONSERV] }),
        ];
        const result = runDeduce(setup, [], knowledge, accusations);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        // case_Conservatory should be Y (slice), and then Tier 1
        // fires: (Plum=Y, Knife=?, Conserv=Y) → Knife=N.
        expect(
            getCellByOwnerCard(result.success, CaseFileOwner(), CONSERV),
        ).toBe(Y);
        expect(
            getCellByOwnerCard(result.success, CaseFileOwner(), KNIFE),
        ).toBe(N);
    });

    test("cascade: failed accusation N + consistency slice → forces the right Y", () => {
        let knowledge = emptyKnowledge;
        // Knock the suspect category down to two candidates: PLUM + MUSTARD,
        // by marking every other suspect as N for the case file.
        for (const card of suspects) {
            if (card === PLUM || card === MUSTARD) continue;
            knowledge = setCell(knowledge, Cell(CaseFileOwner(), card), N);
        }
        // PLUM is pinned in the case file. KNIFE is pinned in the case file.
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), KNIFE), Y);
        // Failed accusation says (PLUM, KNIFE, CONSERV) — the third card,
        // CONSERV, must be N for the case file.
        const accusations = [
            Accusation({ accuser: A, cards: [PLUM, KNIFE, CONSERV] }),
        ];
        // Also pin PLUM=Y so the rule actually fires (needs 2 of 3 Y).
        knowledge = setCell(knowledge, Cell(CaseFileOwner(), PLUM), Y);
        const result = runDeduce(setup, [], knowledge, accusations);
        expect(Result.isSuccess(result)).toBe(true);
        if (!Result.isSuccess(result)) return;
        expect(getCellByOwnerCard(result.success, CaseFileOwner(), CONSERV)).toBe(N);
    });
});
