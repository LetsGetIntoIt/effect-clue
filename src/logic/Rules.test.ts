import { Card, CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    Cell,
    Contradiction,
    emptyKnowledge,
    getCellByOwnerCard,
    N,
    setCell,
    setHandSize,
    Y,
} from "./Knowledge";
import {
    applyConsistencyRules,
    applySlice,
    cardOwnershipSlices,
    caseFileCategorySlices,
    nonRefutersDontHaveSuggestedCards,
    playerHandSlices,
    refuterOwnsOneOf,
    refuterShowedCard,
    Slice,
} from "./Rules";
import { Suggestion } from "./Suggestion";

import "./test-utils/EffectExpectEquals";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const PLUM    = Card("Prof. Plum");
const KNIFE   = Card("Knife");
const CONSERV = Card("Conservatory");

describe("applySlice", () => {
    const threeOwnerSlice = (card: Card): Slice => ({
        cells: [
            Cell(PlayerOwner(A), card),
            Cell(PlayerOwner(B), card),
            Cell(PlayerOwner(C), card),
            Cell(CaseFileOwner(), card),
        ],
        yCount: 1,
        label: `ownership: ${card}`,
    });

    test("no-op when nothing is known", () => {
        const k = applySlice(threeOwnerSlice(KNIFE))(emptyKnowledge);
        expect(k).toEqual(emptyKnowledge);
    });

    test("fills Ns when a Y is present", () => {
        let k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        k = applySlice(threeOwnerSlice(KNIFE))(k);
        expect(getCellByOwnerCard(k, PlayerOwner(A), KNIFE)).toBe(Y);
        expect(getCellByOwnerCard(k, PlayerOwner(B), KNIFE)).toBe(N);
        expect(getCellByOwnerCard(k, PlayerOwner(C), KNIFE)).toBe(N);
        expect(getCellByOwnerCard(k, CaseFileOwner(), KNIFE)).toBe(N);
    });

    test("fills Y when all but one cell is N", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), KNIFE), N);
        k = setCell(k, Cell(PlayerOwner(B), KNIFE), N);
        k = setCell(k, Cell(PlayerOwner(C), KNIFE), N);
        k = applySlice(threeOwnerSlice(KNIFE))(k);
        expect(getCellByOwnerCard(k, CaseFileOwner(), KNIFE)).toBe(Y);
    });

    test("over-saturated slice throws Contradiction", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), KNIFE), Y);
        k = setCell(k, Cell(PlayerOwner(B), KNIFE), Y);
        expect(() => applySlice(threeOwnerSlice(KNIFE))(k)).toThrow(Contradiction);
    });

    test("setCell conflict throws Contradiction", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        expect(() => setCell(k, Cell(PlayerOwner(A), KNIFE), N)).toThrow(Contradiction);
    });
});

describe("slice generators", () => {
    test("cardOwnershipSlices covers every card × every owner", () => {
        const slices = cardOwnershipSlices(setup);
        // One slice per card (6 + 6 + 9 = 21 for classic).
        expect(slices).toHaveLength(21);
        // Each slice spans every owner (3 players + 1 case file = 4).
        for (const s of slices) expect(s.cells).toHaveLength(4);
    });

    test("caseFileCategorySlices has exactly three category slices", () => {
        const slices = caseFileCategorySlices(setup);
        expect(slices).toHaveLength(3);
        expect(slices[0].cells).toHaveLength(setup.suspects.length);
        expect(slices[1].cells).toHaveLength(setup.weapons.length);
        expect(slices[2].cells).toHaveLength(setup.rooms.length);
    });

    test("playerHandSlices only include players with known sizes", () => {
        const k1 = setHandSize(emptyKnowledge, PlayerOwner(A), 3);
        const slices = playerHandSlices(setup, k1);
        expect(slices).toHaveLength(1);
        expect(slices[0].yCount).toBe(3);
    });
});

describe("applyConsistencyRules (fixed-point via slices)", () => {
    test("knowing all but one suspect for case file forces the last", () => {
        let k = emptyKnowledge;
        // Mark Anisha as holding 5 of the 6 suspects.
        for (const card of setup.suspects.slice(0, 5)) {
            k = setCell(k, Cell(PlayerOwner(A), card), Y);
        }
        k = setHandSize(k, PlayerOwner(A), 5);
        k = applyConsistencyRules(setup)(k);
        // After propagation, the 6th suspect must be in the case file
        // (nobody else can hold any suspect: Bob/Cho have N for the five,
        // and Anisha's row is at capacity).
        const sixth = setup.suspects[5];
        expect(getCellByOwnerCard(k, CaseFileOwner(), sixth)).toBe(Y);
    });
});

describe("deduction rules", () => {
    test("nonRefutersDontHaveSuggestedCards", () => {
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [B, C],
        })];
        const k = nonRefutersDontHaveSuggestedCards(suggestions)(emptyKnowledge);
        for (const card of [PLUM, KNIFE, CONSERV]) {
            expect(getCellByOwnerCard(k, PlayerOwner(B), card)).toBe(N);
            expect(getCellByOwnerCard(k, PlayerOwner(C), card)).toBe(N);
        }
        // Anisha's cells remain unknown.
        expect(getCellByOwnerCard(k, PlayerOwner(A), PLUM)).toBeUndefined();
    });

    test("refuterShowedCard sets Y for the seen card", () => {
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
            seenCard: KNIFE,
        })];
        const k = refuterShowedCard(suggestions)(emptyKnowledge);
        expect(getCellByOwnerCard(k, PlayerOwner(B), KNIFE)).toBe(Y);
    });

    test("refuterOwnsOneOf narrows to the last remaining card", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(B), PLUM), N);
        k = setCell(k, Cell(PlayerOwner(B), KNIFE), N);
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        })];
        k = refuterOwnsOneOf(suggestions)(k);
        expect(getCellByOwnerCard(k, PlayerOwner(B), CONSERV)).toBe(Y);
    });

    test("refuterOwnsOneOf stays quiet when it can't narrow down", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(B), PLUM), N);
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        })];
        k = refuterOwnsOneOf(suggestions)(k);
        expect(getCellByOwnerCard(k, PlayerOwner(B), KNIFE)).toBeUndefined();
        expect(getCellByOwnerCard(k, PlayerOwner(B), CONSERV)).toBeUndefined();
    });

    test("refuterOwnsOneOf does nothing when refuter already owns a card", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(B), PLUM), Y);
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        })];
        k = refuterOwnsOneOf(suggestions)(k);
        expect(getCellByOwnerCard(k, PlayerOwner(B), KNIFE)).toBeUndefined();
    });
});
