import { describe, expect, test } from "vitest";
import { Card, Player } from "../../logic/GameObjects";
import {
    applyPassersMove,
    applyRefuterMove,
    applySuggesterMove,
    type FormState,
} from "./SuggestionForm";
import { NOBODY } from "./SuggestionPills";

// ---------------------------------------------------------------------------
// Role-move helpers (M1 #6)
//
// All-options-everywhere: selecting a player into one role moves them out of
// any other role they currently occupy. The previous behaviour filtered the
// candidate lists by role, which trapped users in a sequencing puzzle (clear
// the old role first, then pick again). These helpers keep the form in a
// consistent state without forcing manual cleanup.
// ---------------------------------------------------------------------------

const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");
const D = Player("Dani");

const WRENCH = Card("Wrench");
const ROPE = Card("Rope");

const baseForm = (overrides: Partial<FormState> = {}): FormState => ({
    id: "test-form",
    suggester: null,
    cards: [],
    nonRefuters: null,
    refuter: null,
    seenCard: null,
    ...overrides,
});

describe("applySuggesterMove", () => {
    test("sets suggester when no conflict", () => {
        const next = applySuggesterMove(baseForm(), A);
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(null);
        expect(next.nonRefuters).toBe(null);
    });

    test("removes the new suggester from the passers list", () => {
        const next = applySuggesterMove(
            baseForm({ nonRefuters: [B, A, C] }),
            A,
        );
        expect(next.suggester).toBe(A);
        expect(next.nonRefuters).toEqual([B, C]);
    });

    test("clears the refuter and shown card when the new suggester was the refuter", () => {
        const next = applySuggesterMove(
            baseForm({ refuter: A, seenCard: WRENCH }),
            A,
        );
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(null);
        expect(next.seenCard).toBe(null);
    });

    test("preserves refuter and shown card when no conflict", () => {
        const next = applySuggesterMove(
            baseForm({ refuter: B, seenCard: WRENCH }),
            A,
        );
        expect(next.refuter).toBe(B);
        expect(next.seenCard).toBe(WRENCH);
    });

    test("preserves NOBODY refuter (no player to conflict with)", () => {
        const next = applySuggesterMove(
            baseForm({ refuter: NOBODY }),
            A,
        );
        expect(next.refuter).toBe(NOBODY);
    });

    test("preserves NOBODY passers", () => {
        const next = applySuggesterMove(
            baseForm({ nonRefuters: NOBODY }),
            A,
        );
        expect(next.nonRefuters).toBe(NOBODY);
    });

    test("preserves null passers (not yet decided)", () => {
        const next = applySuggesterMove(
            baseForm({ nonRefuters: null }),
            A,
        );
        expect(next.nonRefuters).toBe(null);
    });
});

describe("applyPassersMove", () => {
    test("sets passers when no conflict", () => {
        const next = applyPassersMove(baseForm(), [B, C]);
        expect(next.nonRefuters).toEqual([B, C]);
        expect(next.suggester).toBe(null);
        expect(next.refuter).toBe(null);
    });

    test("clears the suggester when they show up in the new passers list", () => {
        const next = applyPassersMove(
            baseForm({ suggester: A }),
            [A, B],
        );
        expect(next.nonRefuters).toEqual([A, B]);
        expect(next.suggester).toBe(null);
    });

    test("clears the refuter and shown card when refuter shows up in the new passers list", () => {
        const next = applyPassersMove(
            baseForm({ refuter: B, seenCard: ROPE }),
            [A, B],
        );
        expect(next.nonRefuters).toEqual([A, B]);
        expect(next.refuter).toBe(null);
        expect(next.seenCard).toBe(null);
    });

    test("preserves the suggester and refuter when neither is in the new passers list", () => {
        const next = applyPassersMove(
            baseForm({ suggester: A, refuter: B, seenCard: ROPE }),
            [C, D],
        );
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(B);
        expect(next.seenCard).toBe(ROPE);
    });

    test("NOBODY passes through and does not clear other roles", () => {
        const next = applyPassersMove(
            baseForm({ suggester: A, refuter: B, seenCard: ROPE }),
            NOBODY,
        );
        expect(next.nonRefuters).toBe(NOBODY);
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(B);
        expect(next.seenCard).toBe(ROPE);
    });

    test("null passes through and does not clear other roles", () => {
        const next = applyPassersMove(
            baseForm({ suggester: A, refuter: B }),
            null,
        );
        expect(next.nonRefuters).toBe(null);
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(B);
    });

    test("empty array clears nothing (nobody actively listed yet)", () => {
        const next = applyPassersMove(
            baseForm({ suggester: A, refuter: B }),
            [],
        );
        expect(next.nonRefuters).toEqual([]);
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(B);
    });
});

describe("applyRefuterMove", () => {
    test("sets refuter when no conflict", () => {
        const next = applyRefuterMove(baseForm(), A);
        expect(next.refuter).toBe(A);
        expect(next.suggester).toBe(null);
        expect(next.nonRefuters).toBe(null);
    });

    test("removes the new refuter from the passers list", () => {
        const next = applyRefuterMove(
            baseForm({ nonRefuters: [A, B, C] }),
            B,
        );
        expect(next.refuter).toBe(B);
        expect(next.nonRefuters).toEqual([A, C]);
    });

    test("clears the suggester when the new refuter was the suggester", () => {
        const next = applyRefuterMove(
            baseForm({ suggester: A }),
            A,
        );
        expect(next.refuter).toBe(A);
        expect(next.suggester).toBe(null);
    });

    test("preserves the shown card when refuter is a resolved player", () => {
        const next = applyRefuterMove(
            baseForm({ seenCard: WRENCH }),
            A,
        );
        expect(next.seenCard).toBe(WRENCH);
    });

    test("clears the shown card when refuter becomes NOBODY", () => {
        const next = applyRefuterMove(
            baseForm({ refuter: A, seenCard: WRENCH }),
            NOBODY,
        );
        expect(next.refuter).toBe(NOBODY);
        expect(next.seenCard).toBe(null);
    });

    test("preserves NOBODY passers when committing a real refuter", () => {
        const next = applyRefuterMove(
            baseForm({ nonRefuters: NOBODY }),
            A,
        );
        expect(next.nonRefuters).toBe(NOBODY);
    });

    test("clears suggester AND removes from passers if both conflict (defensive)", () => {
        // The form shouldn't normally reach a state where the same player
        // is suggester AND in passers (the move helpers prevent it for new
        // suggestions), but a loaded draft could. Refuter-move resolves
        // both conflicts at once.
        const next = applyRefuterMove(
            baseForm({ suggester: A, nonRefuters: [A, B] }),
            A,
        );
        expect(next.refuter).toBe(A);
        expect(next.suggester).toBe(null);
        expect(next.nonRefuters).toEqual([B]);
    });
});
