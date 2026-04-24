import { describe, expect, test } from "vitest";
import { Card, CaseFileOwner, Player, PlayerOwner } from "./GameObjects";
import { cardIdsInCategory, CLASSIC_SETUP_3P } from "./GameSetup";
import { cardByName } from "./test-utils/CardByName";
import { expectAt, expectDefined } from "./test-utils/Expect";
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
import { CardOwnership } from "./Provenance";
import type { SetCellRecord, Tracer } from "./Provenance";
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

const setup = CLASSIC_SETUP_3P;
const suspectsCategory = expectDefined(
    setup.categories.find(c => c.name === "Suspect"),
    "Suspect category",
);
const weaponsCategory = expectDefined(
    setup.categories.find(c => c.name === "Weapon"),
    "Weapon category",
);
const roomsCategory = expectDefined(
    setup.categories.find(c => c.name === "Room"),
    "Room category",
);
const suspects = cardIdsInCategory(setup, suspectsCategory.id);
const weapons = cardIdsInCategory(setup, weaponsCategory.id);
const rooms = cardIdsInCategory(setup, roomsCategory.id);
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const PLUM    = cardByName(setup, "Prof. Plum");
const KNIFE   = cardByName(setup, "Knife");
const CONSERV = cardByName(setup, "Conservatory");

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
        kind: CardOwnership({ card }),
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
        expect(expectAt(slices, 0).cells).toHaveLength(suspects.length);
        expect(expectAt(slices, 1).cells).toHaveLength(weapons.length);
        expect(expectAt(slices, 2).cells).toHaveLength(rooms.length);
    });

    test("playerHandSlices only include players with known sizes", () => {
        const k1 = setHandSize(emptyKnowledge, PlayerOwner(A), 3);
        const slices = playerHandSlices(setup, k1);
        expect(slices).toHaveLength(1);
        expect(expectAt(slices, 0).yCount).toBe(3);
    });
});

describe("applyConsistencyRules (fixed-point via slices)", () => {
    test("knowing all but one suspect for case file forces the last", () => {
        let k = emptyKnowledge;
        // Mark Anisha as holding 5 of the 6 suspects.
        for (const card of suspects.slice(0, 5)) {
            k = setCell(k, Cell(PlayerOwner(A), card), Y);
        }
        k = setHandSize(k, PlayerOwner(A), 5);
        k = applyConsistencyRules(setup)(k);
        // After propagation, the 6th suspect must be in the case file
        // (nobody else can hold any suspect: Bob/Cho have N for the five,
        // and Anisha's row is at capacity).
        const sixth = expectAt(suspects, 5, "suspects[5]");
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

describe("provenance tracer", () => {
    const makeTracer = (): { tracer: Tracer; records: SetCellRecord[] } => {
        const records: SetCellRecord[] = [];
        return { tracer: r => records.push(r), records };
    };

    test("applySlice reports dependsOn = all Y cells when forcing Ns", () => {
        const card = KNIFE;
        const slice: Slice = {
            cells: [
                Cell(PlayerOwner(A), card),
                Cell(PlayerOwner(B), card),
                Cell(PlayerOwner(C), card),
                Cell(CaseFileOwner(), card),
            ],
            yCount: 1,
            label: `ownership: ${card}`,
            kind: CardOwnership({ card }),
        };
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), card), Y);

        const { tracer, records } = makeTracer();
        applySlice(slice, tracer)(k);

        // Three cells were forced to N: B, C, and the case file.
        expect(records).toHaveLength(3);
        for (const r of records) {
            expect(r.value).toBe(N);
            expect(r.kind._tag).toBe("CardOwnership");
            expect((r.kind as { card: Card }).card).toBe(card);
            expect(r.dependsOn).toHaveLength(1);
            expect(r.dependsOn[0]).toEqual(Cell(PlayerOwner(A), card));
        }
    });

    test("applySlice reports dependsOn = all N cells when forcing a Y", () => {
        const card = KNIFE;
        const slice: Slice = {
            cells: [
                Cell(PlayerOwner(A), card),
                Cell(PlayerOwner(B), card),
                Cell(PlayerOwner(C), card),
                Cell(CaseFileOwner(), card),
            ],
            yCount: 1,
            label: `ownership: ${card}`,
            kind: CardOwnership({ card }),
        };
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), card), N);
        k = setCell(k, Cell(PlayerOwner(B), card), N);
        k = setCell(k, Cell(PlayerOwner(C), card), N);

        const { tracer, records } = makeTracer();
        applySlice(slice, tracer)(k);

        expect(records).toHaveLength(1);
        const rec = expectAt(records, 0);
        expect(rec.cell).toEqual(Cell(CaseFileOwner(), card));
        expect(rec.value).toBe(Y);
        // dependsOn = the three N cells.
        expect(rec.dependsOn).toHaveLength(3);
    });

    test("nonRefutersDontHaveSuggestedCards tags records with suggestionIndex", () => {
        const { tracer, records } = makeTracer();
        const suggestions = [
            // index 0: Anisha's suggestion passed by nobody
            Suggestion({
                suggester: A, cards: [PLUM], nonRefuters: [],
            }),
            // index 1: Bob's suggestion that Cho passed
            Suggestion({
                suggester: B, cards: [KNIFE], nonRefuters: [C],
            }),
        ];
        nonRefutersDontHaveSuggestedCards(suggestions, tracer)(emptyKnowledge);

        expect(records).toHaveLength(1);
        const rec = expectAt(records, 0);
        expect(rec.cell).toEqual(Cell(PlayerOwner(C), KNIFE));
        expect(rec.value).toBe(N);
        expect(rec.kind._tag).toBe("NonRefuters");
        expect(
            (rec.kind as { suggestionIndex: number }).suggestionIndex,
        ).toBe(1);
    });

    test("refuterShowedCard tags records with suggestionIndex", () => {
        const { tracer, records } = makeTracer();
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
            seenCard: KNIFE,
        })];
        refuterShowedCard(suggestions, tracer)(emptyKnowledge);

        expect(records).toHaveLength(1);
        const rec = expectAt(records, 0);
        expect(rec.value).toBe(Y);
        expect(rec.kind._tag).toBe("RefuterShowed");
        expect(
            (rec.kind as { suggestionIndex: number }).suggestionIndex,
        ).toBe(0);
    });

    test("refuterOwnsOneOf dependsOn = the N cells that narrowed it down", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(B), PLUM), N);
        k = setCell(k, Cell(PlayerOwner(B), KNIFE), N);
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        })];
        const { tracer, records } = makeTracer();
        refuterOwnsOneOf(suggestions, tracer)(k);

        expect(records).toHaveLength(1);
        const rec = expectAt(records, 0);
        expect(rec.cell).toEqual(Cell(PlayerOwner(B), CONSERV));
        expect(rec.value).toBe(Y);
        expect(rec.kind._tag).toBe("RefuterOwnsOneOf");
        expect(
            (rec.kind as { suggestionIndex: number }).suggestionIndex,
        ).toBe(0);
        expect(rec.dependsOn).toHaveLength(2);
        // HashSet iteration order isn't guaranteed; just check both
        // expected cells are present.
        const depKeys = rec.dependsOn.map(c => String(c.card));
        expect(depKeys).toContain(String(PLUM));
        expect(depKeys).toContain(String(KNIFE));
    });
});

describe("structured Contradiction info", () => {
    test("slice over-saturation reports offendingCells and sliceLabel", () => {
        const slice: Slice = {
            cells: [
                Cell(PlayerOwner(A), KNIFE),
                Cell(PlayerOwner(B), KNIFE),
                Cell(PlayerOwner(C), KNIFE),
                Cell(CaseFileOwner(), KNIFE),
            ],
            yCount: 1,
            label: `ownership: ${KNIFE}`,
            kind: CardOwnership({ card: KNIFE }),
        };
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), KNIFE), Y);
        k = setCell(k, Cell(PlayerOwner(B), KNIFE), Y);

        try {
            applySlice(slice)(k);
            expect.fail("expected Contradiction");
        } catch (e) {
            expect(e).toBeInstanceOf(Contradiction);
            const c = e as Contradiction;
            expect(c.sliceLabel).toBe(`ownership: ${KNIFE}`);
            expect(c.offendingCells).toHaveLength(2);
        }
    });

    test("setCell conflict reports the single offending cell", () => {
        const k = setCell(emptyKnowledge, Cell(PlayerOwner(A), KNIFE), Y);
        try {
            setCell(k, Cell(PlayerOwner(A), KNIFE), N);
            expect.fail("expected Contradiction");
        } catch (e) {
            expect(e).toBeInstanceOf(Contradiction);
            const c = e as Contradiction;
            expect(c.offendingCells).toHaveLength(1);
            expect(c.offendingCells[0]).toEqual(Cell(PlayerOwner(A), KNIFE));
        }
    });

    test("suggestion rule propagates suggestionIndex on contradiction", () => {
        // Bob already owns Plum. Then a suggestion where Bob refutes and
        // shows Plum, but the non-refuters list also contains Bob would
        // be malformed — but more easily: pre-mark Bob as N on Plum, then
        // have a suggestion where Bob showed Plum. That forces a setCell
        // conflict attributable to the suggestion.
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(B), PLUM), N);
        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
            seenCard: PLUM,
        })];
        try {
            refuterShowedCard(suggestions)(k);
            expect.fail("expected Contradiction");
        } catch (e) {
            expect(e).toBeInstanceOf(Contradiction);
            const c = e as Contradiction;
            expect(c.suggestionIndex).toBe(0);
        }
    });
});
