import { describe, expect, test } from "vitest";
import { Card, Player } from "../../logic/GameObjects";
import {
    applyPassersMove,
    applyRefuterMove,
    applySuggesterMove,
    type FormState,
    PILL_PASSERS,
    PILL_REFUTER,
    PILL_SEEN,
    PILL_SUGGESTER,
    validateFormConsistency,
} from "./SuggestionForm";
import { NOBODY } from "./SuggestionPills";

// ---------------------------------------------------------------------------
// Role-move helpers.
//
// All-options-everywhere: every pill (Suggester, Passers, Refuter) shows the
// full player list. Conflicts (the same player in two roles) are NOT
// auto-resolved by the move helpers — they're surfaced as dual-pill errors by
// `validateFormConsistency` so the user decides which role to keep. The
// helpers therefore set their own slot and leave the rest of the form alone,
// except for one structural invariant: `applyRefuterMove(NOBODY)` clears
// `seenCard` because "no refuter" semantically means "no shown card".
// ---------------------------------------------------------------------------

const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

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
    test("sets the suggester slot only", () => {
        const next = applySuggesterMove(baseForm(), A);
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(null);
        expect(next.nonRefuters).toBe(null);
        expect(next.seenCard).toBe(null);
    });

    test("does not touch the passers list when the new suggester is already in it", () => {
        const next = applySuggesterMove(
            baseForm({ nonRefuters: [B, A, C] }),
            A,
        );
        expect(next.suggester).toBe(A);
        expect(next.nonRefuters).toEqual([B, A, C]);
    });

    test("does not clear the refuter when the new suggester is already the refuter", () => {
        const next = applySuggesterMove(
            baseForm({ refuter: A, seenCard: WRENCH }),
            A,
        );
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(A);
        expect(next.seenCard).toBe(WRENCH);
    });

    test("preserves NOBODY refuter", () => {
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
});

describe("applyPassersMove", () => {
    test("sets the passers slot only", () => {
        const next = applyPassersMove(baseForm(), [B, C]);
        expect(next.nonRefuters).toEqual([B, C]);
        expect(next.suggester).toBe(null);
        expect(next.refuter).toBe(null);
    });

    test("does not clear the suggester when they appear in the new passers list", () => {
        const next = applyPassersMove(
            baseForm({ suggester: A }),
            [A, B],
        );
        expect(next.nonRefuters).toEqual([A, B]);
        expect(next.suggester).toBe(A);
    });

    test("does not clear the refuter when they appear in the new passers list", () => {
        const next = applyPassersMove(
            baseForm({ refuter: B, seenCard: ROPE }),
            [A, B],
        );
        expect(next.nonRefuters).toEqual([A, B]);
        expect(next.refuter).toBe(B);
        expect(next.seenCard).toBe(ROPE);
    });

    test("NOBODY passes through and leaves other slots untouched", () => {
        const next = applyPassersMove(
            baseForm({ suggester: A, refuter: B, seenCard: ROPE }),
            NOBODY,
        );
        expect(next.nonRefuters).toBe(NOBODY);
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(B);
        expect(next.seenCard).toBe(ROPE);
    });

    test("null passes through and leaves other slots untouched", () => {
        const next = applyPassersMove(
            baseForm({ suggester: A, refuter: B }),
            null,
        );
        expect(next.nonRefuters).toBe(null);
        expect(next.suggester).toBe(A);
        expect(next.refuter).toBe(B);
    });

    test("empty array sets an empty passers list and leaves other slots untouched", () => {
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
    test("sets the refuter slot only", () => {
        const next = applyRefuterMove(baseForm(), A);
        expect(next.refuter).toBe(A);
        expect(next.suggester).toBe(null);
        expect(next.nonRefuters).toBe(null);
    });

    test("does not remove the new refuter from the passers list", () => {
        const next = applyRefuterMove(
            baseForm({ nonRefuters: [A, B, C] }),
            B,
        );
        expect(next.refuter).toBe(B);
        expect(next.nonRefuters).toEqual([A, B, C]);
    });

    test("does not clear the suggester when the new refuter is the suggester", () => {
        const next = applyRefuterMove(
            baseForm({ suggester: A }),
            A,
        );
        expect(next.refuter).toBe(A);
        expect(next.suggester).toBe(A);
    });

    test("preserves the shown card when refuter is a resolved player", () => {
        const next = applyRefuterMove(
            baseForm({ seenCard: WRENCH }),
            A,
        );
        expect(next.seenCard).toBe(WRENCH);
    });

    test("clears the shown card when refuter becomes NOBODY (no refuter ⇒ no shown card)", () => {
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
});

// ---------------------------------------------------------------------------
// validateFormConsistency — cross-role conflicts mark BOTH offending pills so
// the user sees a warning triangle on each side of the paradox, matching the
// Shown-Card error treatment.
// ---------------------------------------------------------------------------

describe("validateFormConsistency", () => {
    test("returns no errors for an empty form", () => {
        const errors = validateFormConsistency(baseForm());
        expect(errors.size).toBe(0);
    });

    test("returns no errors for a well-formed draft", () => {
        const errors = validateFormConsistency(
            baseForm({
                suggester: A,
                cards: [WRENCH],
                nonRefuters: [B],
                refuter: C,
                seenCard: WRENCH,
            }),
        );
        expect(errors.size).toBe(0);
    });

    test("marks BOTH suggester and refuter when they are the same player", () => {
        const errors = validateFormConsistency(
            baseForm({ suggester: A, refuter: A }),
        );
        expect(errors.get(PILL_SUGGESTER)).toBe("suggesterIsRefuter");
        expect(errors.get(PILL_REFUTER)).toBe("suggesterIsRefuter");
        expect(errors.size).toBe(2);
    });

    test("does not flag suggesterIsRefuter when refuter is NOBODY", () => {
        const errors = validateFormConsistency(
            baseForm({ suggester: A, refuter: NOBODY }),
        );
        expect(errors.has(PILL_SUGGESTER)).toBe(false);
        expect(errors.has(PILL_REFUTER)).toBe(false);
    });

    test("marks BOTH suggester and passers when suggester appears in passers", () => {
        const errors = validateFormConsistency(
            baseForm({ suggester: A, nonRefuters: [A, B] }),
        );
        expect(errors.get(PILL_SUGGESTER)).toBe("suggesterInPassers");
        expect(errors.get(PILL_PASSERS)).toBe("suggesterInPassers");
        expect(errors.size).toBe(2);
    });

    test("marks BOTH refuter and passers when refuter appears in passers", () => {
        const errors = validateFormConsistency(
            baseForm({ refuter: B, nonRefuters: [A, B] }),
        );
        expect(errors.get(PILL_REFUTER)).toBe("refuterInPassers");
        expect(errors.get(PILL_PASSERS)).toBe("refuterInPassers");
        expect(errors.size).toBe(2);
    });

    test("when refuter is already flagged as suggesterIsRefuter, refuterInPassers does not overwrite it", () => {
        // suggester == refuter (== A), and A is also in passers — three-way
        // collision. The validator surfaces the suggester/refuter clash on
        // both pills, then flags passers separately for the
        // refuter-in-passers overlap.
        const errors = validateFormConsistency(
            baseForm({ suggester: A, refuter: A, nonRefuters: [A] }),
        );
        expect(errors.get(PILL_SUGGESTER)).toBe("suggesterIsRefuter");
        expect(errors.get(PILL_REFUTER)).toBe("suggesterIsRefuter");
        // PASSERS gets the FIRST passer-side conflict to land on it; whether
        // that's "suggesterInPassers" or "refuterInPassers" is an internal
        // ordering detail.
        const passersCode = errors.get(PILL_PASSERS);
        expect(
            passersCode === "suggesterInPassers" ||
                passersCode === "refuterInPassers",
        ).toBe(true);
    });

    test("flags seenCardWithoutRefuter when seenCard is set but refuter is NOBODY", () => {
        const errors = validateFormConsistency(
            baseForm({
                cards: [WRENCH],
                refuter: NOBODY,
                seenCard: WRENCH,
            }),
        );
        expect(errors.get(PILL_SEEN)).toBe("seenCardWithoutRefuter");
    });

    test("flags seenCardNotSuggested when seenCard is no longer one of the suggested cards", () => {
        const errors = validateFormConsistency(
            baseForm({
                cards: [WRENCH],
                refuter: A,
                seenCard: ROPE,
            }),
        );
        expect(errors.get(PILL_SEEN)).toBe("seenCardNotSuggested");
    });
});
