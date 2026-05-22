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
    subsumePriorWarnings,
    validateFormSoft,
    type PillId,
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
): ReadonlyMap<PillId, SoftWarning> =>
    validateFormSoft(formStateFromDraft(s, setup), {
        knowledge,
        selfPlayerId,
        solverMode: "solve",
        categoryCount: setup.categories.length,
        players: setup.players,
        refuterTouched: true,
        seenCardTouched: true,
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
            players: setup.players,
            refuterTouched: true,
            seenCardTouched: true,
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

    test("refuterCannotRefute (self) — copy now includes the player name", () => {
        // Updated to `"{player} (you) refuted, but has none of these
        // cards"` — the self branch passes the player name through
        // alongside a `(you)` indicator so the two branches read in
        // identical structure.
        const w: SoftWarning = { kind: "refuterCannotRefute", player: ANISHA };
        expect(briefWarningMessage(w, tMock, ANISHA)).toContain(
            "priorWarningSelfRefuterNoMatch",
        );
        expect(briefWarningMessage(w, tMock, ANISHA)).toContain("Anisha");
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

    test("someoneCanRefuteButNobodyMarked single (other)", () => {
        const w: SoftWarning = {
            kind: "someoneCanRefuteButNobodyMarked",
            players: [BOB],
        };
        expect(briefWarningMessage(w, tMock, null)).toContain(
            "priorWarningPlayerCanRefuteRefuterBlank",
        );
        expect(briefWarningMessage(w, tMock, null)).toContain("Bob");
    });

    test("someoneCanRefuteButNobodyMarked single (self)", () => {
        const w: SoftWarning = {
            kind: "someoneCanRefuteButNobodyMarked",
            players: [ANISHA],
        };
        expect(briefWarningMessage(w, tMock, ANISHA)).toBe(
            "priorWarningSelfCanRefuteRefuterBlank",
        );
    });

    test("someoneCanRefuteButNobodyMarked multiple", () => {
        const w: SoftWarning = {
            kind: "someoneCanRefuteButNobodyMarked",
            players: [BOB, CHO],
        };
        expect(briefWarningMessage(w, tMock, null)).toContain(
            "priorWarningPlayersCanRefuteRefuterBlank",
        );
    });

    test("selfSuggesterMissingSeenCard — fixed prompt copy, no interpolation", () => {
        const w: SoftWarning = { kind: "selfSuggesterMissingSeenCard" };
        expect(briefWarningMessage(w, tMock, null)).toBe(
            "priorWarningSelfSuggesterMissingSeenCard",
        );
        // selfPlayerId branch should not matter — same string.
        expect(briefWarningMessage(w, tMock, ANISHA)).toBe(
            "priorWarningSelfSuggesterMissingSeenCard",
        );
    });

    test("selfRefuterMissingSeenCard — fixed prompt copy, no interpolation", () => {
        const w: SoftWarning = { kind: "selfRefuterMissingSeenCard" };
        expect(briefWarningMessage(w, tMock, null)).toBe(
            "priorWarningSelfRefuterMissingSeenCard",
        );
        // selfPlayerId branch should not matter — same string.
        expect(briefWarningMessage(w, tMock, ANISHA)).toBe(
            "priorWarningSelfRefuterMissingSeenCard",
        );
    });
});

describe("prior-log: someoneCanRefuteButNobodyMarked on stored suggestions", () => {
    test("fires when a stored suggestion has refuter=NOBODY and Knowledge shows another player has a card", () => {
        const k = knowledgeWith([[BOB, KNIFE, "Y"]]);
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            // Stored explicit NOBODY: encoded as refuter=undefined +
            // empty nonRefuters; the prior-log reads this via the
            // refutationLine helper. For the validator, NOBODY and
            // undefined both trip the "blank or nobody" gate when
            // refuterTouched=true.
        });
        const w = warnsFor(s, k);
        expect(w.get(PILL_REFUTER)).toEqual({
            kind: "someoneCanRefuteButNobodyMarked",
            players: [BOB],
        });
    });

    test("excludes a can-refute player who is also in the passers list", () => {
        const k = knowledgeWith([[BOB, KNIFE, "Y"]]);
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [BOB],
        });
        const w = warnsFor(s, k);
        expect(w.has(PILL_REFUTER)).toBe(false);
    });
});

describe("prior-log: selfSuggesterMissingSeenCard on stored suggestions", () => {
    test("fires when self is the suggester, refuter is set, and seenCard is missing", () => {
        // ANISHA suggests, BOB refutes, no seenCard recorded.
        // Self = ANISHA → the user would have personally seen the
        // card.
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: BOB,
        });
        const w = warnsFor(s, emptyKnowledge, ANISHA);
        expect(w.get(PILL_SEEN)).toEqual({
            kind: "selfSuggesterMissingSeenCard",
        });
    });

    test("does NOT fire when self is not the suggester", () => {
        // BOB suggests, ANISHA refutes. Self = CHO (irrelevant);
        // we never know what BOB was shown.
        const s = draft({
            suggester: BOB,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: ANISHA,
        });
        const w = warnsFor(s, emptyKnowledge, CHO);
        expect(w.has(PILL_SEEN)).toBe(false);
    });

    test("does NOT fire when a seenCard is recorded", () => {
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: BOB,
            seenCard: KNIFE,
        });
        const w = warnsFor(s, emptyKnowledge, ANISHA);
        expect(w.has(PILL_SEEN)).toBe(false);
    });
});

describe("prior-log: selfRefuterMissingSeenCard on stored suggestions", () => {
    test("fires when self is the refuter and seenCard is missing", () => {
        // BOB suggests, ANISHA refutes, no seenCard recorded.
        // Self = ANISHA → the user personally chose a card to show.
        const s = draft({
            suggester: BOB,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: ANISHA,
        });
        const w = warnsFor(s, emptyKnowledge, ANISHA);
        expect(w.get(PILL_SEEN)).toEqual({
            kind: "selfRefuterMissingSeenCard",
        });
    });

    test("does NOT fire when self is not the refuter", () => {
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: BOB,
        });
        // Self = CHO (a bystander); doesn't know what BOB showed.
        const w = warnsFor(s, emptyKnowledge, CHO);
        expect(w.has(PILL_SEEN)).toBe(false);
    });

    test("does NOT fire when a seenCard is recorded", () => {
        const s = draft({
            suggester: BOB,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: ANISHA,
            seenCard: KNIFE,
        });
        const w = warnsFor(s, emptyKnowledge, ANISHA);
        expect(w.has(PILL_SEEN)).toBe(false);
    });
});

// Subsumption happens between `validateFormSoft` and the display
// loop in <PriorSuggestionItem>. These cases pin the integration —
// the validator produces the redundant pair, `subsumePriorWarnings`
// collapses it. The unit test for the helper alone lives in
// `SuggestionForm.subsumePriorWarnings.test.ts`.
describe("prior-log: subsumePriorWarnings on validateFormSoft output", () => {
    test("self refuted + has none of these cards → only refuterCannotRefute remains (screenshot)", () => {
        // ANISHA = self. ANISHA is the refuter for a suggestion by
        // BOB, but Knowledge says ANISHA has none of the suggested
        // cards. The validator emits BOTH:
        //   • W2 refuterCannotRefute (ANISHA can't possibly refute)
        //   • W6 selfRefuterMissingSeenCard (no shown card recorded)
        // After subsumption only W2 should remain — asking "what
        // card did you show?" is downstream noise when ANISHA can't
        // refute at all.
        const k = knowledgeWith([
            [ANISHA, MUSTARD, "N"],
            [ANISHA, KNIFE, "N"],
            [ANISHA, KITCHEN, "N"],
        ]);
        const s = draft({
            suggester: BOB,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: ANISHA,
        });
        const raw = warnsFor(s, k, ANISHA);
        // Sanity check: the validator emits both warnings.
        expect(raw.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");
        expect(raw.get(PILL_SEEN)?.kind).toBe("selfRefuterMissingSeenCard");

        // After subsumption only the REFUTER warning survives.
        const subsumed = subsumePriorWarnings(raw);
        expect(subsumed.has(PILL_SEEN)).toBe(false);
        expect(subsumed.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");
        expect(subsumed.size).toBe(1);
    });

    test("other refuter has none + self suggested → only refuterCannotRefute remains", () => {
        // Self (ANISHA) suggests; CHO refutes; but Knowledge says
        // CHO has none of the cards. Validator emits W2 + W5
        // (selfSuggesterMissingSeenCard). Subsumed → W2 only.
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
        const raw = warnsFor(s, k, ANISHA);
        expect(raw.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");
        expect(raw.get(PILL_SEEN)?.kind).toBe(
            "selfSuggesterMissingSeenCard",
        );

        const subsumed = subsumePriorWarnings(raw);
        expect(subsumed.has(PILL_SEEN)).toBe(false);
        expect(subsumed.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");
    });

    test("W2 + W3 → only refuterCannotRefute remains", () => {
        // CHO is the refuter with seenCard=KNIFE; Knowledge says CHO
        // has N for all three cards (including KNIFE). The validator
        // emits both W2 and W3; subsumption keeps only W2.
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
            seenCard: KNIFE,
        });
        const raw = warnsFor(s, k);
        expect(raw.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");
        expect(raw.get(PILL_SEEN)?.kind).toBe("shownCardNotInRefuterHand");

        const subsumed = subsumePriorWarnings(raw);
        expect(subsumed.has(PILL_SEEN)).toBe(false);
        expect(subsumed.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");
    });

    test("W1 + W2 (different players) → both remain after subsumption", () => {
        // BOB is a passer who has KNIFE (W1 — passer could refute).
        // CHO is the refuter but Knowledge says CHO has none of the
        // suggested cards (W2). Both warnings describe different
        // players and stay independently actionable.
        const k = knowledgeWith([
            [BOB, KNIFE, "Y"],
            [CHO, MUSTARD, "N"],
            [CHO, KNIFE, "N"],
            [CHO, KITCHEN, "N"],
        ]);
        const s = draft({
            suggester: ANISHA,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [BOB],
            refuter: CHO,
        });
        const raw = warnsFor(s, k);
        expect(raw.get(PILL_PASSERS)?.kind).toBe(
            "passersIncludePlayersWhoCanRefute",
        );
        expect(raw.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");

        const subsumed = subsumePriorWarnings(raw);
        expect(subsumed.get(PILL_PASSERS)?.kind).toBe(
            "passersIncludePlayersWhoCanRefute",
        );
        expect(subsumed.get(PILL_REFUTER)?.kind).toBe("refuterCannotRefute");
        expect(subsumed.size).toBe(2);
    });
});

// Keeps the SCARLET fixture wire-honest in case future cases need a
// fourth distinct card (a multi-warning scenario with a held card
// outside the suggestion, etc.).
test("(plumbing) SCARLET fixture is in scope", () => {
    expect(SCARLET).toBeDefined();
});
