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
import { cardByName } from "../../logic/test-utils/CardByName";
import { computeShownCardAdvice } from "./SuggestionForm";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

const withCells = (
    cells: ReadonlyArray<readonly [Player, ReturnType<typeof cardByName>, CellValue]>,
): Knowledge => {
    let k = emptyKnowledge;
    for (const [player, card, value] of cells) {
        k = setCell(k, Cell(PlayerOwner(player), card), value);
    }
    return k;
};

describe("computeShownCardAdvice", () => {
    test("empty suggestion -> empty map", () => {
        const out = computeShownCardAdvice({
            knowledge: emptyKnowledge,
            selfPlayer: A,
            pendingSuggester: B,
            suggestionCards: [],
            suggestions: [],
            suggesterPerspective: undefined,
        });
        expect(out.size).toBe(0);
    });

    test("card with cell N -> doNotHave badge", () => {
        const k = withCells([[A, MUSTARD, "N"]]);
        const out = computeShownCardAdvice({
            knowledge: k,
            selfPlayer: A,
            pendingSuggester: B,
            suggestionCards: [MUSTARD, KNIFE, KITCHEN],
            suggestions: [],
            suggesterPerspective: undefined,
        });
        expect(out.get(MUSTARD)).toEqual({ kind: "doNotHave" });
        expect(out.has(KNIFE)).toBe(false);
        expect(out.has(KITCHEN)).toBe(false);
    });

    test("card with cell Y, single Y -> candidate forced + tier (no Recommended)", () => {
        const k = withCells([
            [A, MUSTARD, "N"],
            [A, KNIFE, "Y"],
            [A, KITCHEN, "N"],
        ]);
        const out = computeShownCardAdvice({
            knowledge: k,
            selfPlayer: A,
            pendingSuggester: B,
            suggestionCards: [MUSTARD, KNIFE, KITCHEN],
            suggestions: [],
            suggesterPerspective: undefined,
        });
        const knife = out.get(KNIFE);
        expect(knife?.kind).toBe("candidate");
        if (knife?.kind === "candidate") {
            expect(knife.forced).toBe(true);
            expect(knife.recommended).toBe(false);
            expect(knife.tier).toBe("freshLeak");
        }
        expect(out.get(MUSTARD)).toEqual({ kind: "doNotHave" });
        expect(out.get(KITCHEN)).toEqual({ kind: "doNotHave" });
    });

    test("two Y cards, all same tier -> tier label only, no Recommended", () => {
        // Both KNIFE and MUSTARD are Y for self, no prior suggestions/perspective,
        // so both classify as freshLeak. "All same tier" suppresses Recommended.
        const k = withCells([
            [A, MUSTARD, "Y"],
            [A, KNIFE, "Y"],
            [A, KITCHEN, "N"],
        ]);
        const out = computeShownCardAdvice({
            knowledge: k,
            selfPlayer: A,
            pendingSuggester: B,
            suggestionCards: [MUSTARD, KNIFE, KITCHEN],
            suggestions: [],
            suggesterPerspective: undefined,
        });
        const m = out.get(MUSTARD);
        const k2 = out.get(KNIFE);
        expect(m?.kind).toBe("candidate");
        expect(k2?.kind).toBe("candidate");
        if (m?.kind === "candidate" && k2?.kind === "candidate") {
            expect(m.tier).toBe("freshLeak");
            expect(k2.tier).toBe("freshLeak");
            // Multiple Y -> not forced.
            expect(m.forced).toBe(false);
            expect(k2.forced).toBe(false);
            // Same tier -> no Recommended on either.
            expect(m.recommended).toBe(false);
            expect(k2.recommended).toBe(false);
        }
    });

    test("card with cell undefined -> no entry (no badge)", () => {
        const k = withCells([[A, KNIFE, "Y"]]);
        const out = computeShownCardAdvice({
            knowledge: k,
            selfPlayer: A,
            pendingSuggester: B,
            suggestionCards: [MUSTARD, KNIFE, KITCHEN],
            suggestions: [],
            suggesterPerspective: undefined,
        });
        // MUSTARD and KITCHEN are undefined cells (no info) — not in map.
        expect(out.has(MUSTARD)).toBe(false);
        expect(out.has(KITCHEN)).toBe(false);
        expect(out.has(KNIFE)).toBe(true);
    });
});
