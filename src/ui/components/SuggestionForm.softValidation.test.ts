import { describe, expect, test } from "vitest";
import { Player, PlayerOwner } from "../../logic/GameObjects";
import type { SolverMode } from "../../logic/ClueState";
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
    readonly solverMode?: SolverMode;
    readonly refuterTouched?: boolean;
    readonly seenCardTouched?: boolean;
    readonly players?: ReadonlyArray<Player>;
} = {}): SoftValidationContext => ({
    knowledge,
    selfPlayerId: "selfPlayerId" in opts ? opts.selfPlayerId ?? null : A,
    solverMode: opts.solverMode ?? "solve",
    categoryCount: setup.categories.length,
    players: opts.players ?? setup.players,
    // Default both touched flags to `true` so existing tests
    // (written before these fields existed) keep producing the same
    // warnings they did. The new `*Touched`-gated branches have
    // their own describe blocks that exercise both touched values
    // explicitly.
    refuterTouched: opts.refuterTouched ?? true,
    seenCardTouched: opts.seenCardTouched ?? true,
});

describe("validateFormSoft — visibility gates", () => {
    test("returns empty when solverMode is check", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [A],
        };
        expect(validateFormSoft(form, ctxFor(k, { solverMode: "check" })).size)
            .toBe(0);
    });

    test("still validates when selfPlayerId is null (M2: per-player evidence)", () => {
        // selfPlayerId no longer gates the whole layer — every
        // non-suggester player is checked against Knowledge, so the
        // warning still fires for Anisha-in-passers even with no
        // self-player set.
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [A],
        };
        const w = validateFormSoft(form, ctxFor(k, { selfPlayerId: null }));
        expect(w.get(PILL_PASSERS)).toEqual({
            kind: "passersIncludePlayersWhoCanRefute",
            players: [A],
        });
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

describe("validateFormSoft — passersIncludePlayersWhoCanRefute (self)", () => {
    test("fires when self in passers AND any Y on a suggested card (even partial fill)", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [null, KNIFE, null],
            nonRefuters: [A],
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.get(PILL_PASSERS)).toEqual({
            kind: "passersIncludePlayersWhoCanRefute",
            players: [A],
        });
    });

    test("does not fire when no selected passer can refute", () => {
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

    test("skips the suggester even if listed as a passer (hard-error case)", () => {
        // Suggester == passer is a hard error caught elsewhere. The soft
        // validator must not double-flag the suggester via Knowledge.
        const k = withCells([[B, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B],
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_PASSERS)).toBe(false);
    });
});

describe("validateFormSoft — passersIncludePlayersWhoCanRefute (multi-player)", () => {
    test("fires for a single non-self passer with Y on a suggested card", () => {
        const k = withCells([[C, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [C],
        };
        expect(validateFormSoft(form, ctxFor(k)).get(PILL_PASSERS)).toEqual({
            kind: "passersIncludePlayersWhoCanRefute",
            players: [C],
        });
    });

    test("bundles every offending passer into one warning, preserving form order", () => {
        const k = withCells([
            [A, KNIFE, "Y"],
            [C, KITCHEN, "Y"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [C, A],  // form order preserved in the warning
        };
        expect(validateFormSoft(form, ctxFor(k)).get(PILL_PASSERS)).toEqual({
            kind: "passersIncludePlayersWhoCanRefute",
            players: [C, A],
        });
    });

    test("only flags passers with definiteYes; noInfo passers are silent", () => {
        // C has KNIFE; A has nothing on the table — only C should be in
        // the warning payload.
        const k = withCells([[C, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [A, C],
        };
        expect(validateFormSoft(form, ctxFor(k)).get(PILL_PASSERS)).toEqual({
            kind: "passersIncludePlayersWhoCanRefute",
            players: [C],
        });
    });
});

describe("validateFormSoft — refuterCannotRefute (self)", () => {
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
        expect(validateFormSoft(form, ctxFor(k)).get(PILL_REFUTER)).toEqual({
            kind: "refuterCannotRefute",
            player: A,
        });
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

describe("validateFormSoft — refuterCannotRefute (multi-player)", () => {
    test("fires when a non-self refuter is proved to hold none of the cards", () => {
        const k = withCells([
            [C, MUSTARD, "N"],
            [C, KNIFE, "N"],
            [C, KITCHEN, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: C,
        };
        expect(validateFormSoft(form, ctxFor(k)).get(PILL_REFUTER)).toEqual({
            kind: "refuterCannotRefute",
            player: C,
        });
    });

    test("does not fire for NOBODY refuter", () => {
        const k = withCells([
            [C, MUSTARD, "N"],
            [C, KNIFE, "N"],
            [C, KITCHEN, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: NOBODY,
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_REFUTER)).toBe(false);
    });

    test("does not fire when refuter is the suggester (hard-error case)", () => {
        // Suggester == refuter is a hard error caught elsewhere. The
        // soft validator stays silent so the user sees a single
        // unambiguous signal instead of doubling up.
        const k = withCells([
            [B, MUSTARD, "N"],
            [B, KNIFE, "N"],
            [B, KITCHEN, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
        };
        expect(validateFormSoft(form, ctxFor(k)).has(PILL_REFUTER)).toBe(false);
    });
});

describe("validateFormSoft — shownCardNotInRefuterHand (self)", () => {
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
        expect(validateFormSoft(form, ctxFor(k)).get(PILL_SEEN)).toEqual({
            kind: "shownCardNotInRefuterHand",
            player: A,
        });
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

describe("validateFormSoft — shownCardNotInRefuterHand (multi-player)", () => {
    test("fires when a non-self refuter shows a card we know they do not have", () => {
        const k = withCells([[C, MUSTARD, "N"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: C,
            seenCard: MUSTARD,
        };
        expect(validateFormSoft(form, ctxFor(k)).get(PILL_SEEN)).toEqual({
            kind: "shownCardNotInRefuterHand",
            player: C,
        });
    });

    test("does not fire for a non-self refuter when the seenCard cell is undefined", () => {
        const k = withCells([[C, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: C,
            seenCard: MUSTARD,  // no cell on C/MUSTARD -> noInfo
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
        expect(w.get(PILL_REFUTER)).toEqual({
            kind: "refuterCannotRefute",
            player: A,
        });
        expect(w.get(PILL_SEEN)).toEqual({
            kind: "shownCardNotInRefuterHand",
            player: A,
        });
    });

    test("non-self refuter + non-self passer raise warnings on both pills", () => {
        // C in passers but C has KNIFE; A is refuter but A has no card.
        const k = withCells([
            [C, KNIFE, "Y"],
            [A, MUSTARD, "N"],
            [A, KNIFE, "N"],
            [A, KITCHEN, "N"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [C],
            refuter: A,
        };
        const w = validateFormSoft(form, ctxFor(k, { selfPlayerId: null }));
        expect(w.get(PILL_PASSERS)).toEqual({
            kind: "passersIncludePlayersWhoCanRefute",
            players: [C],
        });
        expect(w.get(PILL_REFUTER)).toEqual({
            kind: "refuterCannotRefute",
            player: A,
        });
    });
});

describe("validateFormSoft — someoneCanRefuteButNobodyMarked", () => {
    test("fires when refuter is NOBODY and a non-suggester has a Y for a card", () => {
        const k = withCells([[B, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: null,
            refuter: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.get(PILL_REFUTER)).toEqual({
            kind: "someoneCanRefuteButNobodyMarked",
            players: [B],
        });
    });

    test("fires when refuter is blank AND touched (post-submit / opened+closed)", () => {
        const k = withCells([[B, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: null,
        };
        const w = validateFormSoft(form, ctxFor(k, { refuterTouched: true }));
        expect(w.get(PILL_REFUTER)).toEqual({
            kind: "someoneCanRefuteButNobodyMarked",
            players: [B],
        });
    });

    test("DOES NOT fire when refuter is blank and untouched (pristine add form)", () => {
        const k = withCells([[B, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: null,
        };
        const w = validateFormSoft(form, ctxFor(k, { refuterTouched: false }));
        expect(w.has(PILL_REFUTER)).toBe(false);
    });

    test("DOES NOT fire when no non-suggester is known to have any card", () => {
        // Empty knowledge: nothing is provable, so nobody must refute.
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(emptyKnowledge));
        expect(w.has(PILL_REFUTER)).toBe(false);
    });

    test("excludes players already in the Passers list (avoids redundancy with passersIncludePlayersWhoCanRefute)", () => {
        // B has KNIFE but is in passers — the existing passers warning
        // covers them. The new warning's `players` array should not
        // re-list B. With no OTHER can-refuter available, the new
        // warning should not fire at all.
        const k = withCells([[B, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B],
            refuter: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.get(PILL_PASSERS)).toEqual({
            kind: "passersIncludePlayersWhoCanRefute",
            players: [B],
        });
        expect(w.has(PILL_REFUTER)).toBe(false);
    });

    test("still fires for OTHER can-refuters when one can-refuter is already in passers", () => {
        // B is in passers and has KNIFE (passers warning fires). C
        // also has a card (KITCHEN). The new warning should fire for
        // C only.
        const k = withCells([
            [B, KNIFE, "Y"],
            [C, KITCHEN, "Y"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B],
            refuter: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.get(PILL_REFUTER)).toEqual({
            kind: "someoneCanRefuteButNobodyMarked",
            players: [C],
        });
    });

    test("does not count the suggester as a potential refuter (even if they have a Y cell)", () => {
        // A is the suggester. Even if Knowledge says A has KNIFE,
        // the suggester cannot refute their own suggestion.
        const k = withCells([[A, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.has(PILL_REFUTER)).toBe(false);
    });

    test("fires with multiple can-refuters (all non-suggester, non-passer players counted)", () => {
        const k = withCells([
            [B, MUSTARD, "Y"],
            [C, KNIFE, "Y"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(k));
        const warning = w.get(PILL_REFUTER);
        expect(warning?.kind).toBe("someoneCanRefuteButNobodyMarked");
        if (warning?.kind === "someoneCanRefuteButNobodyMarked") {
            // Order matches `setup.players` iteration; B before C in
            // CLASSIC_SETUP_3P.
            expect(warning.players).toEqual([B, C]);
        }
    });

    test("suppressed in check (teach-me) mode", () => {
        const k = withCells([[B, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(k, { solverMode: "check" }));
        expect(w.has(PILL_REFUTER)).toBe(false);
    });

    test("does not fire when refuter is a specific (non-Nobody) player", () => {
        // Even if other players also have cards, picking a specific
        // refuter means the "blank/nobody" case doesn't apply.
        const k = withCells([
            [B, KNIFE, "Y"],
            [C, KITCHEN, "Y"],
        ]);
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.has(PILL_REFUTER)).toBe(false);
    });

    test("does not fire when suggester is null (incomplete form)", () => {
        const k = withCells([[B, KNIFE, "Y"]]);
        const form: FormState = {
            ...baseFormState(),
            suggester: null,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(k));
        expect(w.has(PILL_REFUTER)).toBe(false);
    });
});

describe("validateFormSoft — selfSuggesterMissingSeenCard", () => {
    test("fires when self is suggester, refuter is set, and seenCard is NOBODY", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
            seenCard: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(emptyKnowledge));
        // ctxFor defaults selfPlayerId to A.
        expect(w.get(PILL_SEEN)).toEqual({
            kind: "selfSuggesterMissingSeenCard",
        });
    });

    test("fires when self is suggester, refuter is set, and seenCard is blank AND touched", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
            seenCard: null,
        };
        const w = validateFormSoft(
            form,
            ctxFor(emptyKnowledge, { seenCardTouched: true }),
        );
        expect(w.get(PILL_SEEN)).toEqual({
            kind: "selfSuggesterMissingSeenCard",
        });
    });

    test("DOES NOT fire when seenCard is blank and untouched (pristine form)", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
            seenCard: null,
        };
        const w = validateFormSoft(
            form,
            ctxFor(emptyKnowledge, { seenCardTouched: false }),
        );
        expect(w.has(PILL_SEEN)).toBe(false);
    });

    test("DOES NOT fire when suggester is not self", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: C,
            seenCard: NOBODY,
        };
        // selfPlayerId stays A (the default) — different from
        // suggester B, so we never know what B was shown.
        const w = validateFormSoft(form, ctxFor(emptyKnowledge));
        expect(w.has(PILL_SEEN)).toBe(false);
    });

    test("DOES NOT fire when selfPlayerId is null", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
            seenCard: NOBODY,
        };
        const w = validateFormSoft(
            form,
            ctxFor(emptyKnowledge, { selfPlayerId: null }),
        );
        expect(w.has(PILL_SEEN)).toBe(false);
    });

    test("DOES NOT fire when refuter is NOBODY (round had no refutation)", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: NOBODY,
            seenCard: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(emptyKnowledge));
        expect(w.has(PILL_SEEN)).toBe(false);
    });

    test("DOES NOT fire when refuter is null (incomplete form)", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: null,
            seenCard: NOBODY,
        };
        const w = validateFormSoft(form, ctxFor(emptyKnowledge));
        expect(w.has(PILL_SEEN)).toBe(false);
    });

    test("DOES NOT fire when a real seen card has been recorded", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
            seenCard: KNIFE,
        };
        const w = validateFormSoft(form, ctxFor(emptyKnowledge));
        expect(w.has(PILL_SEEN)).toBe(false);
    });

    test("suppressed in check (teach-me) mode", () => {
        const form: FormState = {
            ...baseFormState(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            refuter: B,
            seenCard: NOBODY,
        };
        const w = validateFormSoft(
            form,
            ctxFor(emptyKnowledge, { solverMode: "check" }),
        );
        expect(w.has(PILL_SEEN)).toBe(false);
    });
});

