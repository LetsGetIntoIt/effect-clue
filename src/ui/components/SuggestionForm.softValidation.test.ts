import { describe, expect, test } from "vitest";
import { Player, PlayerOwner } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import {
    Cell,
    emptyKnowledge,
    Knowledge,
    setCell,
    type CellValue,
} from "../../logic/Knowledge";
import { SuggestionId } from "../../logic/Suggestion";
import { cardByName } from "../../logic/test-utils/CardByName";
import {
    PILL_PASSERS,
    PILL_REFUTER,
    PILL_SEEN,
    validateFormSoft,
    type FormState,
    type SoftValidationContext,
} from "./SuggestionForm";
import { NOBODY } from "./SuggestionPills";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");
const ROPE = cardByName(setup, "Rope");

const baseFormState = (): FormState => ({
    id: String(SuggestionId("soft-test")),
    suggester: null,
    cards: setup.categories.map(() => null),
    nonRefuters: null,
    refuter: null,
    seenCard: null,
});

const withCells = (
    cells: ReadonlyArray<readonly [Player, ReturnType<typeof cardByName>, CellValue]>,
): Knowledge => {
    let k = emptyKnowledge;
    for (const [player, card, value] of cells) {
        k = setCell(k, Cell(PlayerOwner(player), card), value);
    }
    return k;
};

const ctxFor = (knowledge: Knowledge | undefined, opts: {
    readonly selfPlayerId?: Player | null;
    readonly teachMode?: boolean;
} = {}): SoftValidationContext => ({
    knowledge,
    selfPlayerId: "selfPlayerId" in opts ? opts.selfPlayerId ?? null : A,
    teachMode: opts.teachMode ?? false,
    categoryCount: setup.categories.length,
});

describe("validateFormSoft — visibility gates", () => {
    test("returns empty when teachMode is true", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [A],
        };
        expect(validateFormSoft(form, ctxFor(k, { teachMode: true })).size)
            .toBe(0);
    });

    test("returns empty when selfPlayerId is null", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [A],
        };
        expect(
            validateFormSoft(form, ctxFor(k, { selfPlayerId: null })).size,
        ).toBe(0);
    });

    test("returns empty when knowledge is undefined", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [A],
        };
        expect(validateFormSoft(form, ctxFor(undefined)).size).toBe(0);
    });

    test("returns empty when self is the suggester (handled by hard errors)", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [A],
        };
        expect(validateFormSoft(form, ctxFor(k)).size).toBe(0);
    });
});

describe("validateFormSoft — passersIncludeSelfWhoCanRefute", () => {
    test("fires when self in passers AND any Y on a suggested card (even partial fill)", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [null, KNIFE, null],
            nonRefuters: [A],
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.get(PILL_PASSERS)).toBe("passersIncludeSelfWhoCanRefute");
    });

    test("does not fire when self not in passers", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [C],
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_PASSERS)).toBe(false);
    });

    test("does not fire with NOBODY passers", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: NOBODY,
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_PASSERS)).toBe(false);
    });

    test("does not fire when self in passers but evidence is noInfo (partial knowledge)", () => {
        // All categories filled but no Y or N on KITCHEN — definiteNo can't fire.
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [A],
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_PASSERS)).toBe(false);
    });
});

describe("validateFormSoft — selfIsRefuterWithNoMatch", () => {
    test("fires when self is refuter AND all chosen cards are N AND all categories filled", () => {
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "N"],
            [A, KITCHEN, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: A,
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.get(PILL_REFUTER)).toBe("selfIsRefuterWithNoMatch");
    });

    test("does not fire when self is refuter but only some categories are filled", () => {
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, null],
            refuter: A,
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_REFUTER)).toBe(false);
    });

    test("does not fire when self is refuter but at least one card has Y (definiteYes)", () => {
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "Y"],
            [A, KITCHEN, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: A,
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_REFUTER)).toBe(false);
    });

    test("does not fire when self is refuter with partial knowledge (some undefined cells)", () => {
        // KITCHEN has no cell — caller's "all N" claim cannot be definitive.
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: A,
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_REFUTER)).toBe(false);
    });
});

describe("validateFormSoft — shownCardNotInSelfHand", () => {
    test("fires when self is refuter AND seenCard has cell value N", () => {
        const k = withCells([
            [A, KNIFE, "Y"],
            [A, MUSTARD, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: A,
            seenCard: MUSTARD,
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.get(PILL_SEEN)).toBe("shownCardNotInSelfHand");
    });

    test("does not fire when seenCard has cell value Y (self has it)", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: A,
            seenCard: KNIFE,
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_SEEN)).toBe(false);
    });

    test("does not fire when seenCard cell is undefined (no info)", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: A,
            seenCard: KITCHEN,  // no cell -> no warning
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_SEEN)).toBe(false);
    });

    test("does not fire when self is not the refuter", () => {
        const k = withCells([[A, MUSTARD, "N"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: C,
            seenCard: MUSTARD,
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_SEEN)).toBe(false);
    });

    test("does not fire when seenCard is NOBODY", () => {
        const k = withCells([[A, MUSTARD, "N"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: A,
            seenCard: NOBODY,
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_SEEN)).toBe(false);
    });
});

describe("validateFormSoft — multiple warnings combine", () => {
    test("self as both refuter and seenCard mismatch raises two warnings", () => {
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "N"],
            [A, KITCHEN, "N"],
            [A, ROPE, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: A,
            seenCard: MUSTARD,
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.get(PILL_REFUTER)).toBe("selfIsRefuterWithNoMatch");
        expect(w.get(PILL_SEEN)).toBe("shownCardNotInSelfHand");
    });
});
