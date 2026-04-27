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
