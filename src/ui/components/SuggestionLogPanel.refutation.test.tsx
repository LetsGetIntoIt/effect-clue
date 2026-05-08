import { describe, expect, test } from "vitest";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { Player } from "../../logic/GameObjects";
import { newSuggestionId } from "../../logic/Suggestion";
import { cardByName } from "../../logic/test-utils/CardByName";
import type { DraftSuggestion } from "../../logic/ClueState";
import { refutationStatus } from "./SuggestionLogPanel";

// ---------------------------------------------------------------------------
// `refutationStatus` picks the ICU select branch the prior-suggestion line
// will render. Each branch maps to a distinct copy template in
// `suggestions.refutationLine`; the post-M3 copy is:
//
//   refutedSeenPassed -> "Passed by {passers}; refuted by X (showed Y)"
//   refutedSeen       -> "Nobody passed; refuted by X (showed Y)"
//   refutedPassed     -> "Passed by {passers}; refuted by X (card not seen)"
//   refuted           -> "Nobody passed; refuted by X (card not seen)"
//   nobodyPassed      -> "Passed by {passers}; nobody refuted"
//   nobody            -> "Nobody passed; nobody refuted"
//
// Pinning every branch here means re-shuffling the predicate above won't
// silently flip a copy variant.
// ---------------------------------------------------------------------------

const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");
const SUSPECT = cardByName(CLASSIC_SETUP_3P, "Col. Mustard");
const KNIFE = cardByName(CLASSIC_SETUP_3P, "Knife");
const KITCHEN = cardByName(CLASSIC_SETUP_3P, "Kitchen");

const draft = (overrides: Partial<DraftSuggestion> = {}): DraftSuggestion => ({
    id: newSuggestionId(),
    suggester: A,
    cards: [SUSPECT, KNIFE, KITCHEN],
    nonRefuters: [],
    ...overrides,
});

describe("refutationStatus — all six branches", () => {
    test("refutedSeenPassed: refuter + seen card + at least one passer", () => {
        expect(
            refutationStatus(
                draft({
                    nonRefuters: [B],
                    refuter: C,
                    seenCard: KNIFE,
                }),
            ),
        ).toBe("refutedSeenPassed");
    });

    test("refutedSeen: refuter + seen card, no passers", () => {
        expect(
            refutationStatus(
                draft({
                    nonRefuters: [],
                    refuter: B,
                    seenCard: KNIFE,
                }),
            ),
        ).toBe("refutedSeen");
    });

    test("refutedPassed: refuter without seen card, with passers", () => {
        expect(
            refutationStatus(
                draft({
                    nonRefuters: [B],
                    refuter: C,
                }),
            ),
        ).toBe("refutedPassed");
    });

    test("refuted: refuter without seen card and without passers", () => {
        expect(
            refutationStatus(
                draft({
                    nonRefuters: [],
                    refuter: B,
                }),
            ),
        ).toBe("refuted");
    });

    test("nobodyPassed: no refuter but passers exist", () => {
        expect(
            refutationStatus(
                draft({
                    nonRefuters: [B, C],
                }),
            ),
        ).toBe("nobodyPassed");
    });

    test("nobody: no refuter and no passers", () => {
        expect(
            refutationStatus(
                draft({
                    nonRefuters: [],
                }),
            ),
        ).toBe("nobody");
    });
});
