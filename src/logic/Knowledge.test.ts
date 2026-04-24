import { describe, expect, test } from "vitest";
import { Equal, HashMap, Option } from "effect";
import { CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { cardByName } from "./test-utils/CardByName";
import {
    Cell,
    Contradiction,
    emptyKnowledge,
    getCell,
    getCellByOwnerCard,
    getHandSize,
    N,
    setCell,
    setHandSize,
    Y,
} from "./Knowledge";

const setup = CLASSIC_SETUP_3P;
const KNIFE = cardByName(setup, "Knife");
const PLUM = cardByName(setup, "Prof. Plum");
const KITCHEN = cardByName(setup, "Kitchen");
const A = Player("Anisha");
const B = Player("Bob");

describe("Cell", () => {
    test("structurally-equal cells are Equal.equals", () => {
        const c1 = Cell(PlayerOwner(A), KNIFE);
        const c2 = Cell(PlayerOwner(A), KNIFE);
        expect(Equal.equals(c1, c2)).toBe(true);
    });

    test("PlayerOwner and CaseFileOwner cells differ for the same card", () => {
        const c1 = Cell(PlayerOwner(A), KNIFE);
        const c2 = Cell(CaseFileOwner(), KNIFE);
        expect(Equal.equals(c1, c2)).toBe(false);
    });

    test("cells with different cards differ", () => {
        const c1 = Cell(PlayerOwner(A), KNIFE);
        const c2 = Cell(PlayerOwner(A), PLUM);
        expect(Equal.equals(c1, c2)).toBe(false);
    });

    test("cells with different players differ", () => {
        const c1 = Cell(PlayerOwner(A), KNIFE);
        const c2 = Cell(PlayerOwner(B), KNIFE);
        expect(Equal.equals(c1, c2)).toBe(false);
    });

    test("exposes owner and card as named fields", () => {
        const cell = Cell(PlayerOwner(A), KNIFE);
        expect(cell.card).toBe(KNIFE);
        expect(Equal.equals(cell.owner, PlayerOwner(A))).toBe(true);
    });

    test("HashMap keyed on Cell retrieves via a structurally-equivalent key", () => {
        const key = Cell(PlayerOwner(A), KNIFE);
        const lookup = Cell(PlayerOwner(A), KNIFE);
        const map = HashMap.set(HashMap.empty<Cell, string>(), key, "hit");
        expect(Option.getOrUndefined(HashMap.get(map, lookup))).toBe("hit");
    });
});

describe("emptyKnowledge", () => {
    test("has an empty checklist", () => {
        expect(HashMap.size(emptyKnowledge.checklist)).toBe(0);
    });

    test("has empty hand sizes", () => {
        expect(HashMap.size(emptyKnowledge.handSizes)).toBe(0);
    });

    test("has no cell values for any (owner, card) pair", () => {
        expect(getCellByOwnerCard(emptyKnowledge, PlayerOwner(A), KNIFE))
            .toBeUndefined();
        expect(getCellByOwnerCard(emptyKnowledge, CaseFileOwner(), PLUM))
            .toBeUndefined();
    });
});

describe("getCell / getCellByOwnerCard", () => {
    test("returns undefined for an unknown cell", () => {
        expect(getCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE)))
            .toBeUndefined();
    });

    test("returns Y for a cell set to Y", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        expect(getCell(k, Cell(PlayerOwner(A), KNIFE))).toBe(Y);
    });

    test("returns N for a cell set to N", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), N);
        expect(getCell(k, Cell(PlayerOwner(A), KNIFE))).toBe(N);
    });

    test("getCellByOwnerCard is equivalent to getCell(k, Cell(owner, card))", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        expect(getCellByOwnerCard(k, PlayerOwner(A), KNIFE)).toBe(
            getCell(k, Cell(PlayerOwner(A), KNIFE)),
        );
    });
});

describe("getHandSize", () => {
    test("returns undefined when no size is set", () => {
        expect(getHandSize(emptyKnowledge, PlayerOwner(A))).toBeUndefined();
    });

    test("returns the size that was set", () => {
        const k = setHandSize(emptyKnowledge, PlayerOwner(A), 3);
        expect(getHandSize(k, PlayerOwner(A))).toBe(3);
    });

    test("returns undefined for a different owner than was set", () => {
        const k = setHandSize(emptyKnowledge, PlayerOwner(A), 3);
        expect(getHandSize(k, PlayerOwner(B))).toBeUndefined();
    });
});

describe("setCell", () => {
    test("sets an unknown cell to Y", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        expect(getCellByOwnerCard(k, PlayerOwner(A), KNIFE)).toBe(Y);
    });

    test("sets an unknown cell to N", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), N);
        expect(getCellByOwnerCard(k, PlayerOwner(A), KNIFE)).toBe(N);
    });

    test("is a no-op (reference-equal return) when the same value is already set", () => {
        const k1 = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        const k2 = setCell(k1, Cell(PlayerOwner(A), KNIFE), Y);
        expect(k2).toBe(k1);
    });

    test("does not mutate the input Knowledge", () => {
        setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        expect(getCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE)))
            .toBeUndefined();
    });

    test("preserves unrelated cells when writing a new one", () => {
        let k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        k = setCell(k, Cell(PlayerOwner(B), PLUM), N);
        expect(getCellByOwnerCard(k, PlayerOwner(A), KNIFE)).toBe(Y);
        expect(getCellByOwnerCard(k, PlayerOwner(B), PLUM)).toBe(N);
    });

    test("preserves previously-written hand sizes", () => {
        let k = setHandSize(emptyKnowledge, PlayerOwner(B), 3);
        k = setCell(k, Cell(PlayerOwner(A), KNIFE), Y);
        expect(getHandSize(k, PlayerOwner(B))).toBe(3);
    });

    test("throws Contradiction when flipping Y → N", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        expect(() => setCell(k, Cell(PlayerOwner(A), KNIFE), N))
            .toThrow(Contradiction);
    });

    test("throws Contradiction when flipping N → Y", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), N);
        expect(() => setCell(k, Cell(PlayerOwner(A), KNIFE), Y))
            .toThrow(Contradiction);
    });

    test("Contradiction records the offending cell and a reason mentioning the owner label", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        try {
            setCell(k, Cell(PlayerOwner(A), KNIFE), N);
            throw new Error("expected Contradiction");
        } catch (e) {
            expect(e).toBeInstanceOf(Contradiction);
            const c = e as Contradiction;
            expect(c.offendingCells).toHaveLength(1);
            expect(Equal.equals(c.offendingCells[0], Cell(PlayerOwner(A), KNIFE)))
                .toBe(true);
            expect(c.reason).toMatch(/Anisha/);
            expect(c.reason).toMatch(/Y/);
            expect(c.reason).toMatch(/N/);
        }
    });
});

describe("setHandSize", () => {
    test("sets a size for a new owner", () => {
        const k = setHandSize(emptyKnowledge, PlayerOwner(A), 5);
        expect(getHandSize(k, PlayerOwner(A))).toBe(5);
    });

    test("overwrites an existing size for the same owner", () => {
        let k = setHandSize(emptyKnowledge, PlayerOwner(A), 5);
        k = setHandSize(k, PlayerOwner(A), 3);
        expect(getHandSize(k, PlayerOwner(A))).toBe(3);
    });

    test("does not mutate the input Knowledge", () => {
        setHandSize(emptyKnowledge, PlayerOwner(A), 5);
        expect(getHandSize(emptyKnowledge, PlayerOwner(A))).toBeUndefined();
    });

    test("preserves previously-written cells", () => {
        let k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KITCHEN), Y);
        k = setHandSize(k, PlayerOwner(B), 3);
        expect(getCellByOwnerCard(k, PlayerOwner(A), KITCHEN)).toBe(Y);
    });

    test("preserves other owners' hand sizes", () => {
        let k = setHandSize(emptyKnowledge, PlayerOwner(A), 5);
        k = setHandSize(k, PlayerOwner(B), 3);
        expect(getHandSize(k, PlayerOwner(A))).toBe(5);
        expect(getHandSize(k, PlayerOwner(B))).toBe(3);
    });

    test("accepts a size of 0 (used by preset defaults for CaseFile-sized holes)", () => {
        const k = setHandSize(emptyKnowledge, PlayerOwner(A), 0);
        expect(getHandSize(k, PlayerOwner(A))).toBe(0);
    });
});
