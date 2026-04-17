import { HashMap } from "effect";
import { Card, CardCategory, CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { cardsInCategory, CLASSIC_SETUP_3P } from "./GameSetup";
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
import deduce from "./Deducer";

import "./test-utils/EffectExpectEquals";

const setup = CLASSIC_SETUP_3P;
const suspects = cardsInCategory(setup, CardCategory("Suspects"));
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

// Shorthands for a handful of cards we'll reference in tests.
const MUSTARD  = Card("Col. Mustard");
const PLUM     = Card("Prof. Plum");
const KNIFE    = Card("Knife");
const REVOLVER = Card("Revolver");
const ROPE     = Card("Rope");
const KITCHEN  = Card("Kitchen");
const LIBRARY  = Card("Library");
const CONSERV  = Card("Conservatory");

describe("deduce", () => {
    test("empty inputs produce empty knowledge", () => {
        const result = deduce(setup, [])(emptyKnowledge);
        expect(result._tag).toBe("Ok");
        if (result._tag !== "Ok") return;
        expect(HashMap.size(result.knowledge.checklist)).toBe(0);
    });

    test("card ownership propagates: one Y forces Ns elsewhere", () => {
        let knowledge = emptyKnowledge;
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), MUSTARD), Y);

        const result = deduce(setup, [])(knowledge);
        expect(result._tag).toBe("Ok");
        if (result._tag !== "Ok") return;

        // Every other owner now has N for Col. Mustard.
        expect(getCellByOwnerCard(result.knowledge, PlayerOwner(B), MUSTARD)).toBe(N);
        expect(getCellByOwnerCard(result.knowledge, PlayerOwner(C), MUSTARD)).toBe(N);
        expect(getCellByOwnerCard(result.knowledge, CaseFileOwner(), MUSTARD)).toBe(N);
    });

    test("case file category narrows to single candidate", () => {
        let knowledge = emptyKnowledge;
        // If nobody owns 5 of the 6 suspects, the 6th must be in the case file.
        for (const card of suspects.slice(0, 5)) {
            knowledge = setCell(knowledge, Cell(PlayerOwner(A), card), Y);
        }
        // Anisha has 5 cards; tell the solver the size so it can fill Ns.
        knowledge = setHandSize(knowledge, PlayerOwner(A), 5);

        const result = deduce(setup, [])(knowledge);
        expect(result._tag).toBe("Ok");
        if (result._tag !== "Ok") return;

        const sixth = suspects[5];
        // The last suspect must be in the case file.
        expect(getCellByOwnerCard(result.knowledge, CaseFileOwner(), sixth)).toBe(Y);
    });

    test("non-refuters don't have the suggested cards", () => {
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [B, C],
        })];

        const result = deduce(setup, suggestions)(emptyKnowledge);
        expect(result._tag).toBe("Ok");
        if (result._tag !== "Ok") return;

        for (const card of [PLUM, KNIFE, CONSERV]) {
            expect(getCellByOwnerCard(result.knowledge, PlayerOwner(B), card)).toBe(N);
            expect(getCellByOwnerCard(result.knowledge, PlayerOwner(C), card)).toBe(N);
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

        const result = deduce(setup, suggestions)(emptyKnowledge);
        expect(result._tag).toBe("Ok");
        if (result._tag !== "Ok") return;

        expect(getCellByOwnerCard(result.knowledge, PlayerOwner(B), CONSERV)).toBe(Y);
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

        const result = deduce(setup, suggestions)(knowledge);
        expect(result._tag).toBe("Ok");
        if (result._tag !== "Ok") return;

        expect(getCellByOwnerCard(result.knowledge, PlayerOwner(B), CONSERV)).toBe(Y);
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

        const result = deduce(setup, suggestions)(knowledge);
        expect(result._tag).toBe("Ok");
        if (result._tag !== "Ok") return;

        const k = result.knowledge;
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

    test("contradiction is surfaced as a result", () => {
        let knowledge = emptyKnowledge;
        // Both Anisha and Bob have Knife? That's a contradiction once the
        // card-ownership rule fires.
        knowledge = setCell(knowledge, Cell(PlayerOwner(A), KNIFE), Y);
        knowledge = setCell(knowledge, Cell(PlayerOwner(B), KNIFE), Y);

        const result = deduce(setup, [])(knowledge);
        expect(result._tag).toBe("Contradiction");
    });
});
