import { Player } from "../../logic/GameObjects";
import { cardByName } from "../../logic/test-utils/CardByName";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { SuggestionId } from "../../logic/Suggestion";
import {
    buildDraftFromForm,
    isPillDisabledFor,
    PILL_REFUTER,
    PILL_SEEN,
    PILL_SUGGESTER,
    validateFormConsistency,
    type FormState,
    type PillId,
} from "./SuggestionForm";

// Shadow of NOBODY for tests — the sentinel isn't exported so tests
// can't import it, but the form-state shape uses it. We re-derive a
// reference-equal copy by calling the form with a draft that uses
// the "nobody" branches. Simpler: mirror the exact sentinel here.
// The production module does `Object.freeze({ kind: "nobody" })`;
// we match that literal so `=== NOBODY` would work if it were
// exported. For our tests, only need the narrowing to work — we
// sidestep by never passing NOBODY through `buildDraftFromForm` and
// instead verify the `null` → empty / undefined mapping.

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

const baseFormState = (): FormState => ({
    id: String(SuggestionId("test-id")),
    suggester: null,
    cards: setup.categories.map(() => null),
    nonRefuters: null,
    refuter: null,
    seenCard: null,
});

describe("buildDraftFromForm", () => {
    test("returns null when suggester is empty", () => {
        expect(buildDraftFromForm(baseFormState())).toBeNull();
    });

    test("returns null when any required card slot is empty", () => {
        const form = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, null, KITCHEN],
        };
        expect(buildDraftFromForm(form)).toBeNull();
    });

    test("minimal valid form yields a draft with empty passers / no refuter", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
        };
        const draft = buildDraftFromForm(form);
        expect(draft).not.toBeNull();
        expect(draft!.suggester).toBe(A);
        expect(draft!.cards).toEqual([MUSTARD, KNIFE, KITCHEN]);
        expect(draft!.nonRefuters).toEqual([]);
        // exactOptionalPropertyTypes: fields should be omitted when
        // not applicable, not set to `undefined`.
        expect("refuter" in draft!).toBe(false);
        expect("seenCard" in draft!).toBe(false);
    });

    test("dedupes duplicate passers (order-preserving)", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B, C, B, B, C],
        };
        const draft = buildDraftFromForm(form);
        expect(draft!.nonRefuters).toEqual([B, C]);
    });

    test("resolved refuter + seen card populate the optional fields", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
            seenCard: KNIFE,
        };
        const draft = buildDraftFromForm(form);
        expect(draft!.refuter).toBe(B);
        expect(draft!.seenCard).toBe(KNIFE);
    });

    test("preserves the form id (lets callers round-trip edits)", () => {
        const form: FormState = {
            ...baseFormState(),
            id: String(SuggestionId("stable-id")),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
        };
        const draft = buildDraftFromForm(form);
        expect(String(draft!.id)).toBe("stable-id");
    });
});

describe("isPillDisabledFor", () => {
    const nonSeenPills: ReadonlyArray<PillId> = [
        PILL_SUGGESTER,
        PILL_REFUTER,
    ];

    test("PILL_SEEN disabled when refuter is null", () => {
        const form = { ...baseFormState(), refuter: null };
        expect(isPillDisabledFor(form, PILL_SEEN)).toBe(true);
    });

    test("PILL_SEEN enabled when refuter is a resolved player", () => {
        const form = { ...baseFormState(), refuter: B };
        expect(isPillDisabledFor(form, PILL_SEEN)).toBe(false);
    });

    test("non-seen pills are never disabled by this helper", () => {
        const form = baseFormState();
        for (const id of nonSeenPills) {
            expect(isPillDisabledFor(form, id)).toBe(false);
        }
    });
});

describe("validateFormConsistency", () => {
    test("clean form has no errors", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
            seenCard: KNIFE,
        };
        expect(validateFormConsistency(form).size).toBe(0);
    });

    test("seenCard not in suggested cards -> error on PILL_SEEN", () => {
        // Stale seenCard: user swapped the weapon after picking a
        // shown card.
        const ROPE = cardByName(CLASSIC_SETUP_3P, "Rope");
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, ROPE, KITCHEN],
            refuter: B,
            seenCard: KNIFE,
        };
        const errors = validateFormConsistency(form);
        expect(errors.get(PILL_SEEN)).toBe("seenCardNotSuggested");
    });

    test("seenCard set without a refuter -> error on PILL_SEEN", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: null,
            seenCard: KNIFE,
        };
        const errors = validateFormConsistency(form);
        expect(errors.get(PILL_SEEN)).toBe("seenCardWithoutRefuter");
    });

    test("suggester === refuter -> error on PILL_REFUTER", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: A,
        };
        const errors = validateFormConsistency(form);
        expect(errors.get(PILL_REFUTER)).toBe("suggesterIsRefuter");
    });

    test("suggester ∈ passers -> error on PILL_SUGGESTER", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [A, C],
        };
        const errors = validateFormConsistency(form);
        expect(errors.get(PILL_SUGGESTER)).toBe("suggesterInPassers");
    });

    test("refuter ∈ passers -> error on PILL_REFUTER", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B],
            refuter: B,
        };
        const errors = validateFormConsistency(form);
        expect(errors.get(PILL_REFUTER)).toBe("refuterInPassers");
    });

    test("seenCard omitted -> no error even with a broken cards list", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, null, KITCHEN],
        };
        expect(validateFormConsistency(form).size).toBe(0);
    });
});
