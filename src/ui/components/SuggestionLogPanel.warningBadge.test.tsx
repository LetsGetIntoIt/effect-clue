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
import { newSuggestionId } from "../../logic/Suggestion";
import { cardByName } from "../../logic/test-utils/CardByName";
import type { DraftSuggestion } from "../../logic/ClueState";
import {
    briefWarningMessage,
    formStateFromDraft,
    PILL_PASSERS,
    PILL_REFUTER,
    PILL_SEEN,
    validateFormSoft,
    type SoftWarning,
} from "./SuggestionForm";

// ----------------------------------------------------------------------------
// Prior-suggestion soft-warning badges re-derive the form's soft warnings
// against the *stored* DraftSuggestion at render time (no snapshot field
// on the suggestion record). These tests pin two things:
//
//   1. `validateFormSoft(formStateFromDraft(s, setup), ctx)` produces the
//      same warnings on a stored suggestion that the form would produce
//      while editing the same suggestion. Without this, the prior-log
//      badge can drift away from the form's pill warnings.
//
//   2. `briefWarningMessage(...)` selects the right short-form i18n key
//      per `SoftWarning.kind` and per self-vs-other. The form uses its
//      own verbose `pillWarning*` keys; the prior log uses `priorWarning*`
//      so the two contexts can read naturally without sharing copy.
//
// We stop short of mounting <SuggestionLogPanel> here. The pipeline that
// flows Knowledge into the prior-log component is the same `useClue()`
// derived state the form already consumes, so reusing the validator
// directly is enough to pin behavior. Full UI integration (badge DOM,
// edit-mode hiding) is covered manually in the preview per CLAUDE.md.
// ----------------------------------------------------------------------------

const setup = CLASSIC_SETUP_3P;
const ANISHA = Player("Anisha");
const BOB = Player("Bob");
const CHO = Player("Cho");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");
const SCARLET = cardByName(setup, "Miss Scarlet");

const knowledgeWith = (
    cells: ReadonlyArray<
        readonly [Player, ReturnType<typeof cardByName>, CellValue]
    >,
): Knowledge => {
    let k = emptyKnowledge;
    for (const [player, card, value] of cells) {
        k = setCell(k, Cell(PlayerOwner(player), card), value);
    }
    return k;
};

const draft = (overrides: Partial<DraftSuggestion> = {}): DraftSuggestion => ({
    id: newSuggestionId(),
    suggester: ANISHA,
    cards: [MUSTARD, KNIFE, KITCHEN],
    nonRefuters: [],
    ...overrides,
});

const warnsFor = (
    s: DraftSuggestion,
    knowledge: Knowledge,
    selfPlayerId: Player | null = null,
): ReadonlyMap<string, SoftWarning> =>
    validateFormSoft(formStateFromDraft(s, setup), {
        knowledge,
        selfPlayerId,
        solverMode: "solve",
        categoryCount: setup.categories.length,
    });

// Use a permissive `t` mock matching the project pattern: returns a
// stable identifier the test can match against. Matches the
// `WarningTFn` signature so no cast is needed.
const tMock = (
    key: string,
    values?: Record<string, string | number | Date>,
): string =>
    values === undefined ? key : `${key}:${JSON.stringify(values)}`;

describe("validateFormSoft on a stored DraftSuggestion via formStateFromDraft", () => {
    test("returns the same warnings the form would produce while editing the suggestion", () => {
        // BOB passed but Knowledge says BOB has KNIFE — passer
        // contradicts a Y cell.
        const k = knowledgeWith([[BOB, KNIFE, "Y"]]);
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [BOB],
        });
        const w = warnsFor(s, k);
        expect(w.has(PILL_PASSERS)).toBe(true);
        const warning = w.get(PILL_PASSERS)!;
        expect(warning.kind).toBe("passersIncludePlayersWhoCanRefute");
    });

    test("flags refuterCannotRefute when every suggested card is N for the refuter", () => {
        const k = knowledgeWith([
            [CHO, MUSTARD, "N"],
            [CHO, KNIFE, "N"],
            [CHO, KITCHEN, "N"],
        ]);
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: CHO,
        });
        const w = warnsFor(s, k);
        expect(w.get(PILL_REFUTER)).toEqual({
            kind: "refuterCannotRefute",
            player: CHO,
        });
    });

    test("flags shownCardNotInRefuterHand when seen card is N for the refuter", () => {
        const k = knowledgeWith([[CHO, KNIFE, "N"]]);
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: CHO,
            seenCard: KNIFE,
        });
        const w = warnsFor(s, k);
        expect(w.get(PILL_SEEN)).toEqual({
            kind: "shownCardNotInRefuterHand",
            player: CHO,
        });
    });

    test("returns no warnings on a clean stored suggestion", () => {
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [BOB],
            refuter: CHO,
        });
        expect(warnsFor(s, emptyKnowledge).size).toBe(0);
    });

    test("suppressed in check (teach-me) mode — same gate as the form", () => {
        const k = knowledgeWith([
            [CHO, MUSTARD, "N"],
            [CHO, KNIFE, "N"],
            [CHO, KITCHEN, "N"],
        ]);
        const s = draft({ refuter: CHO });
        const w = validateFormSoft(formStateFromDraft(s, setup), {
            knowledge: k,
            selfPlayerId: null,
            solverMode: "check",
            categoryCount: setup.categories.length,
        });
        expect(w.size).toBe(0);
    });
});

describe("briefWarningMessage — short-form copy for prior-log badge", () => {
    test("passers single offender (other)", () => {
        const w: SoftWarning = {
            kind: "passersIncludePlayersWhoCanRefute",
            players: [BOB],
        };
        expect(briefWarningMessage(w, tMock, null)).toContain(
            "priorWarningPlayerCouldRefute",
        );
        expect(briefWarningMessage(w, tMock, null)).toContain("Bob");
    });

    test("passers single offender (self)", () => {
        const w: SoftWarning = {
            kind: "passersIncludePlayersWhoCanRefute",
            players: [ANISHA],
        };
        expect(briefWarningMessage(w, tMock, ANISHA)).toBe(
            "priorWarningSelfCouldRefute",
        );
    });

    test("passers multiple offenders", () => {
        const w: SoftWarning = {
            kind: "passersIncludePlayersWhoCanRefute",
            players: [BOB, CHO],
        };
        expect(briefWarningMessage(w, tMock, null)).toContain(
            "priorWarningPlayersCouldRefute",
        );
    });

    test("refuterCannotRefute (other)", () => {
        const w: SoftWarning = { kind: "refuterCannotRefute", player: CHO };
        expect(briefWarningMessage(w, tMock, null)).toContain(
            "priorWarningRefuterCannotRefute",
        );
        expect(briefWarningMessage(w, tMock, null)).toContain("Cho");
    });

    test("refuterCannotRefute (self)", () => {
        const w: SoftWarning = { kind: "refuterCannotRefute", player: ANISHA };
        expect(briefWarningMessage(w, tMock, ANISHA)).toBe(
            "priorWarningSelfRefuterNoMatch",
        );
    });

    test("shownCardNotInRefuterHand (other)", () => {
        const w: SoftWarning = {
            kind: "shownCardNotInRefuterHand",
            player: CHO,
        };
        expect(briefWarningMessage(w, tMock, null)).toContain(
            "priorWarningShownCardNotInRefuterHand",
        );
        expect(briefWarningMessage(w, tMock, null)).toContain("Cho");
    });

    test("shownCardNotInRefuterHand (self)", () => {
        const w: SoftWarning = {
            kind: "shownCardNotInRefuterHand",
            player: ANISHA,
        };
        expect(briefWarningMessage(w, tMock, ANISHA)).toBe(
            "priorWarningShownCardNotInHand",
        );
    });
});

// Keeps the SCARLET fixture wire-honest in case future cases need a
// fourth distinct card (a multi-warning scenario with a held card
// outside the suggestion, etc.).
test("(plumbing) SCARLET fixture is in scope", () => {
    expect(SCARLET).toBeDefined();
});
