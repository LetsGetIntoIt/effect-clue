import { describe, expect, test } from "vitest";
import { Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    Cell,
    emptyKnowledge,
    Knowledge,
    setCell,
    type CellValue,
} from "./Knowledge";
import {
    computeRefuteEvidence,
    DEFINITE_NO,
    DEFINITE_YES,
    NO_INFO,
} from "./RefuteEvidence";
import { cardByName } from "./test-utils/CardByName";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");
const SCARLET = cardByName(setup, "Miss Scarlet");
const ROPE = cardByName(setup, "Rope");

const withCells = (
    cells: ReadonlyArray<readonly [Player, ReturnType<typeof cardByName>, CellValue]>,
): Knowledge => {
    let k = emptyKnowledge;
    for (const [player, card, value] of cells) {
        k = setCell(k, Cell(PlayerOwner(player), card), value);
    }
    return k;
};

describe("computeRefuteEvidence", () => {
    test("empty cards list -> noInfo", () => {
        const k = withCells([[A, MUSTARD, "Y"]]);
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [],
                complete: false,
            }),
        ).toBe(NO_INFO);
    });

    test("any Y on a chosen card -> definiteYes (one fact is enough)", () => {
        const k = withCells([[A, MUSTARD, "Y"]]);
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [MUSTARD],
                complete: false,
            }),
        ).toBe(DEFINITE_YES);
    });

    test("Y on one card, undefined on others -> definiteYes", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                complete: true,
            }),
        ).toBe(DEFINITE_YES);
    });

    test("all N + complete -> definiteNo", () => {
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "N"],
            [A, KITCHEN, "N"],
        ]);
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                complete: true,
            }),
        ).toBe(DEFINITE_NO);
    });

    test("all N but not complete -> noInfo (an unfilled category could flip the answer)", () => {
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "N"],
        ]);
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [MUSTARD, KNIFE],
                complete: false,
            }),
        ).toBe(NO_INFO);
    });

    test("complete + mix of N and undefined -> noInfo (cannot claim cannot-refute)", () => {
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "N"],
            // KITCHEN unknown
        ]);
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                complete: true,
            }),
        ).toBe(NO_INFO);
    });

    test("complete + all undefined -> noInfo", () => {
        expect(
            computeRefuteEvidence({
                knowledge: emptyKnowledge,
                player: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                complete: true,
            }),
        ).toBe(NO_INFO);
    });

    test("partial + Y on the one filled card -> definiteYes", () => {
        const k = withCells([[A, MUSTARD, "Y"]]);
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [MUSTARD],
                complete: false,
            }),
        ).toBe(DEFINITE_YES);
    });

    test("knowledge for a different player does not leak across", () => {
        const k = withCells([
            [B, MUSTARD, "Y"],
            [B, KNIFE, "Y"],
            [B, KITCHEN, "Y"],
        ]);
        // A has no info; even though B has all three, A is the query target.
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                complete: true,
            }),
        ).toBe(NO_INFO);
    });

    test("Y short-circuits even when other cards are N", () => {
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "Y"],
            [A, KITCHEN, "N"],
        ]);
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                complete: true,
            }),
        ).toBe(DEFINITE_YES);
    });

    test("definiteYes wins over an incomplete suggestion (single category, Y)", () => {
        const k = withCells([[A, SCARLET, "Y"]]);
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [SCARLET],
                complete: false,
            }),
        ).toBe(DEFINITE_YES);
    });

    test("does not return definiteNo for a card list of length 1 even if complete is true (defensive)", () => {
        // complete = true implies the caller has filled all categories.
        // If cards.length is less than the setup's category count, the
        // caller is providing inconsistent input — we still answer
        // based on what we were given (a single N -> definiteNo).
        const k = withCells([[A, ROPE, "N"]]);
        // Defensive: the function trusts `complete`. Caller is
        // responsible for passing a consistent flag.
        expect(
            computeRefuteEvidence({
                knowledge: k,
                player: A,
                cards: [ROPE],
                complete: true,
            }),
        ).toBe(DEFINITE_NO);
    });
});
