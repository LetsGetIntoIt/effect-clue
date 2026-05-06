// This file tests rule MECHANISMS in isolation. The same scenarios are
// repeated in `Deducer.test.ts` at the `runDeduce` layer to catch
// pipeline-wiring regressions. If you delete coverage from one layer,
// delete or replace it in the other — they're a deliberate two-layer
// pattern, not duplication.

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
    applyAllRules,
    applyConsistencyRules,
    applySlice,
    cardOwnershipSlices,
    caseFileCategorySlices,
    disjointGroupsHandLock,
    failedAccusationEliminate,
    failedAccusationPairwiseNarrow,
    nonRefutersDontHaveSuggestedCards,
    playerHandSlices,
    refuterOwnsOneOf,
    refuterShowedCard,
    Slice,
} from "./Rules";
import { Accusation } from "./Accusation";
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

    // Regression: when the suggester owns one of the named cards, the
    // card-ownership consistency slice cascades that Y into N on the
    // refuter's row in the same iteration of applyAllRules. That extra N
    // is exactly what refuterOwnsOneOf needs to narrow the remaining two
    // cards to one. This test guards the cascade — a future reorder of
    // the rule pipeline (e.g. moving applyDeductionRules ahead of
    // applyConsistencyRules) would silently regress it without this
    // assertion. The behaviour itself is implicit; no rule code change
    // is required.
    test("applyAllRules: suggester-owned card cascades through card-ownership "
        + "so refuterOwnsOneOf narrows on a single explicit N", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), PLUM),  Y);
        k = setCell(k, Cell(PlayerOwner(B), KNIFE), N);

        const suggestions = [Suggestion({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [],
            refuter: B,
        })];

        k = applyAllRules(setup, suggestions, [])(k);

        // Cascade: A/Plum=Y forces B/Plum=N via card-ownership slice.
        expect(getCellByOwnerCard(k, PlayerOwner(B), PLUM)).toBe(N);
        // refuterOwnsOneOf then sees two Ns on B's row for the suggested
        // cards and forces the remaining one (Conservatory) to Y.
        expect(getCellByOwnerCard(k, PlayerOwner(B), CONSERV)).toBe(Y);
    });
});

// -----------------------------------------------------------------------
// disjointGroupsHandLock
// -----------------------------------------------------------------------

describe("disjointGroupsHandLock", () => {
    // Three pairwise-disjoint suggestion triples — each touches a
    // distinct suspect/weapon/room combo.
    const SCARLET   = cardByName(setup, "Miss Scarlet");
    const ROPE      = cardByName(setup, "Rope");
    const LIBRARY   = cardByName(setup, "Library");
    const GREEN     = cardByName(setup, "Mr. Green");
    const WRENCH    = cardByName(setup, "Wrench");
    const HALL      = cardByName(setup, "Hall");
    const MUSTARD   = cardByName(setup, "Col. Mustard");

    const refutedBy = (
        suggester: Player,
        refuter: Player,
        cards: ReadonlyArray<Card>,
    ) =>
        Suggestion({
            suggester,
            cards,
            nonRefuters: [],
            refuter,
        });

    test("two disjoint sets + handRemaining=2 → out-of-union cells go N", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 2);
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
            refutedBy(A, B, [SCARLET, ROPE, LIBRARY]),
        ];

        k = disjointGroupsHandLock(setup, suggestions)(k);

        // In-union cells stay unknown — we know one is Y per set, but not which.
        expect(getCellByOwnerCard(k, PlayerOwner(B), PLUM)).toBeUndefined();
        expect(getCellByOwnerCard(k, PlayerOwner(B), SCARLET)).toBeUndefined();
        // Out-of-union cell forced N — Bob's two hand slots are spoken for.
        expect(getCellByOwnerCard(k, PlayerOwner(B), GREEN)).toBe(N);
        expect(getCellByOwnerCard(k, PlayerOwner(B), MUSTARD)).toBe(N);
        expect(getCellByOwnerCard(k, PlayerOwner(B), WRENCH)).toBe(N);
        expect(getCellByOwnerCard(k, PlayerOwner(B), HALL)).toBe(N);
        // Other players' rows untouched.
        expect(getCellByOwnerCard(k, PlayerOwner(A), GREEN)).toBeUndefined();
    });

    test("three disjoint sets + handRemaining=3 → out-of-union cells go N", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 3);
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
            refutedBy(A, B, [SCARLET, ROPE, LIBRARY]),
            refutedBy(A, B, [GREEN, WRENCH, HALL]),
        ];
        k = disjointGroupsHandLock(setup, suggestions)(k);
        expect(getCellByOwnerCard(k, PlayerOwner(B), MUSTARD)).toBe(N);
    });

    test("overlap between sets → rule does not fire", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 2);
        // PLUM appears in both — sets overlap, disjointness fails.
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
            refutedBy(A, B, [PLUM, ROPE, LIBRARY]),
        ];
        k = disjointGroupsHandLock(setup, suggestions)(k);
        expect(getCellByOwnerCard(k, PlayerOwner(B), GREEN)).toBeUndefined();
    });

    test("only one qualifying suggestion → rule does not fire", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 2);
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
        ];
        k = disjointGroupsHandLock(setup, suggestions)(k);
        expect(getCellByOwnerCard(k, PlayerOwner(B), GREEN)).toBeUndefined();
    });

    test("K < handRemaining → rule does not fire", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 5);
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
            refutedBy(A, B, [SCARLET, ROPE, LIBRARY]),
        ];
        // K=2 disjoint sets but Bob still has 5 unknown hand slots.
        k = disjointGroupsHandLock(setup, suggestions)(k);
        expect(getCellByOwnerCard(k, PlayerOwner(B), GREEN)).toBeUndefined();
    });

    test("handSize unknown → rule skipped", () => {
        let k = emptyKnowledge;
        // No setHandSize for B.
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
            refutedBy(A, B, [SCARLET, ROPE, LIBRARY]),
        ];
        k = disjointGroupsHandLock(setup, suggestions)(k);
        expect(getCellByOwnerCard(k, PlayerOwner(B), GREEN)).toBeUndefined();
    });

    test("seenCard defined → suggestion ignored by the rule", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 2);
        const suggestions = [
            // refuterShowedCard handles this one — exclude from disjoint logic.
            Suggestion({
                suggester: A,
                cards: [PLUM, KNIFE, CONSERV],
                nonRefuters: [],
                refuter: B,
                seenCard: PLUM,
            }),
            refutedBy(A, B, [SCARLET, ROPE, LIBRARY]),
        ];
        k = disjointGroupsHandLock(setup, suggestions)(k);
        // Only one qualifying set survives → rule doesn't fire.
        expect(getCellByOwnerCard(k, PlayerOwner(B), GREEN)).toBeUndefined();
    });

    test("a set already containing a Y is dropped, K shrinks accordingly", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 2);
        // Bob already known to own Plum, so the first set is satisfied
        // and effectively contributes nothing more — we'd need 2 more
        // disjoint sets for K=handRemaining-1=1 to fire, but K=1 isn't
        // enough (rule requires ≥2 surviving sets).
        k = setCell(k, Cell(PlayerOwner(B), PLUM), Y);
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
            refutedBy(A, B, [SCARLET, ROPE, LIBRARY]),
        ];
        k = disjointGroupsHandLock(setup, suggestions)(k);
        expect(getCellByOwnerCard(k, PlayerOwner(B), GREEN)).toBeUndefined();
    });

    test("known-N cells inside a set shrink it but rule still fires", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 2);
        // Two Ns inside the first set — the unknown remainder still
        // pairs disjointly with the second set's cards.
        k = setCell(k, Cell(PlayerOwner(B), KNIFE),    N);
        k = setCell(k, Cell(PlayerOwner(B), CONSERV),  N);
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
            refutedBy(A, B, [SCARLET, ROPE, LIBRARY]),
        ];
        k = disjointGroupsHandLock(setup, suggestions)(k);
        // Out-of-union cells still N.
        expect(getCellByOwnerCard(k, PlayerOwner(B), GREEN)).toBe(N);
    });

    test("groupCount > handRemaining throws DisjointGroupsHandLock contradiction", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 1);
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
            refutedBy(A, B, [SCARLET, ROPE, LIBRARY]),
        ];
        try {
            disjointGroupsHandLock(setup, suggestions)(k);
            // Vitest: must throw.
            expect.fail("expected Contradiction");
        } catch (e) {
            expect(e).toBeInstanceOf(Contradiction);
            const c = e as Contradiction;
            expect(c.contradictionKind?._tag).toBe("DisjointGroupsHandLock");
            if (c.contradictionKind?._tag !== "DisjointGroupsHandLock") return;
            expect(c.contradictionKind.player).toBe(B);
            expect(c.contradictionKind.suggestionIndices).toEqual([0, 1]);
            // Offending cells span both sets' unknown cards.
            expect(c.offendingCells.length).toBeGreaterThan(0);
        }
    });

    test("tracer records DisjointGroupsHandLock kind with both indices", () => {
        let k = emptyKnowledge;
        k = setHandSize(k, PlayerOwner(B), 2);
        const suggestions = [
            refutedBy(A, B, [PLUM, KNIFE, CONSERV]),
            refutedBy(A, B, [SCARLET, ROPE, LIBRARY]),
        ];
        const records: SetCellRecord[] = [];
        const tracer: Tracer = r => records.push(r);
        disjointGroupsHandLock(setup, suggestions, tracer)(k);

        expect(records.length).toBeGreaterThan(0);
        for (const rec of records) {
            expect(rec.value).toBe(N);
            expect(rec.kind._tag).toBe("DisjointGroupsHandLock");
            if (rec.kind._tag !== "DisjointGroupsHandLock") continue;
            expect(rec.kind.player).toBe(B);
            expect(rec.kind.suggestionIndices).toEqual([0, 1]);
            expect(rec.dependsOn.length).toBe(6); // both sets' three cells each
        }
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

    test("over-Y card-ownership slice tags contradictionKind as SliceCardOwnership/over", () => {
        const slice: Slice = {
            cells: [
                Cell(PlayerOwner(A), KNIFE),
                Cell(PlayerOwner(B), KNIFE),
                Cell(PlayerOwner(C), KNIFE),
                Cell(CaseFileOwner(), KNIFE),
            ],
            yCount: 1,
            label: `card ownership: ${KNIFE}`,
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
            expect(c.contradictionKind).toBeDefined();
            expect(c.contradictionKind?._tag).toBe("SliceCardOwnership");
            expect(
                (c.contradictionKind as { card: Card } | undefined)?.card,
            ).toBe(KNIFE);
            expect(
                (c.contradictionKind as { direction: "over" | "under" } | undefined)
                    ?.direction,
            ).toBe("over");
        }
    });

    test("over-N card-ownership slice tags contradictionKind as SliceCardOwnership/under", () => {
        const slice: Slice = {
            cells: [
                Cell(PlayerOwner(A), KNIFE),
                Cell(PlayerOwner(B), KNIFE),
                Cell(PlayerOwner(C), KNIFE),
                Cell(CaseFileOwner(), KNIFE),
            ],
            yCount: 1,
            label: `card ownership: ${KNIFE}`,
            kind: CardOwnership({ card: KNIFE }),
        };
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), KNIFE), N);
        k = setCell(k, Cell(PlayerOwner(B), KNIFE), N);
        k = setCell(k, Cell(PlayerOwner(C), KNIFE), N);
        k = setCell(k, Cell(CaseFileOwner(), KNIFE), N);
        try {
            applySlice(slice)(k);
            expect.fail("expected Contradiction");
        } catch (e) {
            expect(e).toBeInstanceOf(Contradiction);
            const c = e as Contradiction;
            expect(c.contradictionKind?._tag).toBe("SliceCardOwnership");
            expect(
                (c.contradictionKind as { direction: "over" | "under" } | undefined)
                    ?.direction,
            ).toBe("under");
        }
    });

    test("nonRefutersDontHaveSuggestedCards tags contradictionKind as NonRefuters", () => {
        // Anisha is known to have Plum. A suggestion where Anisha was a
        // non-refuter that names Plum forces setCell(Anisha, Plum, N) →
        // collision with the existing Y → wrapped Contradiction.
        let k = emptyKnowledge;
        k = setCell(k, Cell(PlayerOwner(A), PLUM), Y);
        const suggestions = [Suggestion({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
            nonRefuters: [A],
            refuter: undefined,
            seenCard: undefined,
        })];
        try {
            nonRefutersDontHaveSuggestedCards(suggestions)(k);
            expect.fail("expected Contradiction");
        } catch (e) {
            expect(e).toBeInstanceOf(Contradiction);
            const c = e as Contradiction;
            expect(c.contradictionKind?._tag).toBe("NonRefuters");
            expect(
                (c.contradictionKind as { suggestionIndex: number } | undefined)
                    ?.suggestionIndex,
            ).toBe(0);
        }
    });

    test("refuterShowedCard tags contradictionKind as RefuterShowed", () => {
        // Bob is already known not to have Plum, but the suggestion says
        // Bob refuted by showing Plum → setCell collision → wrapped.
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
            expect(c.contradictionKind?._tag).toBe("RefuterShowed");
            expect(
                (c.contradictionKind as { suggestionIndex: number } | undefined)
                    ?.suggestionIndex,
            ).toBe(0);
        }
    });

    // refuterOwnsOneOf wraps setCell defensively (matching the shape of
    // the other suggestion rules), but in practice its catch is
    // unreachable when run in isolation: the rule only sets cells from
    // the `unknowns` list, and setCell never throws on an unknown cell.
    // Contradictions that originate from a refuterOwnsOneOf inference
    // surface via a downstream consistency slice (`SliceCardOwnership`
    // or `SlicePlayerHand`) on a later iteration of the deducer's
    // fixed-point loop. The slice test cases above cover that path.
});

// -----------------------------------------------------------------------
// failedAccusationEliminate
// -----------------------------------------------------------------------

describe("failedAccusationEliminate", () => {
    const SCARLET = cardByName(setup, "Miss Scarlet");
    const ROPE    = cardByName(setup, "Rope");
    const HALL    = cardByName(setup, "Hall");

    const failed = (accuser: Player, cards: ReadonlyArray<Card>) =>
        Accusation({ accuser, cards });

    test("no-op when all three cells are unknown", () => {
        const accusations = [failed(A, [PLUM, KNIFE, CONSERV])];
        const k = failedAccusationEliminate(accusations)(emptyKnowledge);
        expect(getCellByOwnerCard(k, CaseFileOwner(), PLUM)).toBeUndefined();
        expect(getCellByOwnerCard(k, CaseFileOwner(), KNIFE)).toBeUndefined();
        expect(getCellByOwnerCard(k, CaseFileOwner(), CONSERV)).toBeUndefined();
    });

    test("no-op when only one of the three is Y (insufficient evidence)", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        const accusations = [failed(A, [PLUM, KNIFE, CONSERV])];
        k = failedAccusationEliminate(accusations)(k);
        expect(getCellByOwnerCard(k, CaseFileOwner(), KNIFE)).toBeUndefined();
        expect(getCellByOwnerCard(k, CaseFileOwner(), CONSERV)).toBeUndefined();
    });

    test("forces N on the third cell when the other two case-file cells are Y", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        k = setCell(k, Cell(CaseFileOwner(), KNIFE), Y);
        const accusations = [failed(A, [PLUM, KNIFE, CONSERV])];
        k = failedAccusationEliminate(accusations)(k);
        expect(getCellByOwnerCard(k, CaseFileOwner(), CONSERV)).toBe(N);
    });

    test("rule satisfied — any cell already N short-circuits the rule", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        k = setCell(k, Cell(CaseFileOwner(), KNIFE), Y);
        // The third one is N already; no inference needed.
        k = setCell(k, Cell(CaseFileOwner(), CONSERV), N);
        const accusations = [failed(A, [PLUM, KNIFE, CONSERV])];
        // Should NOT throw and should NOT change anything.
        const next = failedAccusationEliminate(accusations)(k);
        expect(next).toEqual(k);
    });

    test("rule satisfied with two known Ns and one Y → no inference", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), N);
        k = setCell(k, Cell(CaseFileOwner(), KNIFE), N);
        k = setCell(k, Cell(CaseFileOwner(), CONSERV), Y);
        const accusations = [failed(A, [PLUM, KNIFE, CONSERV])];
        const next = failedAccusationEliminate(accusations)(k);
        expect(next).toEqual(k);
    });

    test("all three Y → contradiction with FailedAccusation kind", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        k = setCell(k, Cell(CaseFileOwner(), KNIFE), Y);
        k = setCell(k, Cell(CaseFileOwner(), CONSERV), Y);
        const accusations = [failed(A, [PLUM, KNIFE, CONSERV])];
        try {
            failedAccusationEliminate(accusations)(k);
            expect.fail("expected Contradiction");
        } catch (e) {
            expect(e).toBeInstanceOf(Contradiction);
            const c = e as Contradiction;
            expect(c.contradictionKind?._tag).toBe("FailedAccusation");
            if (c.contradictionKind?._tag !== "FailedAccusation") return;
            expect(c.contradictionKind.accusationIndex).toBe(0);
            expect(c.accusationIndex).toBe(0);
            // All three Ys are listed as offending cells.
            expect(c.offendingCells).toHaveLength(3);
        }
    });

    test("multi-accusation: two failed accusations both fire on disjoint cells", () => {
        let k = emptyKnowledge;
        // First accusation already pinned: PLUM=Y, KNIFE=Y → forces CONSERV=N.
        k = setCell(k, Cell(CaseFileOwner(), PLUM),  Y);
        k = setCell(k, Cell(CaseFileOwner(), KNIFE), Y);
        // Second accusation pins SCARLET=Y, ROPE=Y → forces HALL=N.
        k = setCell(k, Cell(CaseFileOwner(), SCARLET), Y);
        k = setCell(k, Cell(CaseFileOwner(), ROPE),    Y);
        const accusations = [
            failed(A, [PLUM, KNIFE, CONSERV]),
            failed(B, [SCARLET, ROPE, HALL]),
        ];
        k = failedAccusationEliminate(accusations)(k);
        expect(getCellByOwnerCard(k, CaseFileOwner(), CONSERV)).toBe(N);
        expect(getCellByOwnerCard(k, CaseFileOwner(), HALL)).toBe(N);
    });

    test("tracer records FailedAccusation kind with the right accusationIndex", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        k = setCell(k, Cell(CaseFileOwner(), KNIFE), Y);
        const accusations = [
            // Index 0 — doesn't match the case file shape
            failed(A, [SCARLET, ROPE, HALL]),
            // Index 1 — the one we expect to fire
            failed(B, [PLUM, KNIFE, CONSERV]),
        ];
        const records: SetCellRecord[] = [];
        const tracer: Tracer = r => records.push(r);
        failedAccusationEliminate(accusations, tracer)(k);
        expect(records).toHaveLength(1);
        const rec = expectAt(records, 0);
        expect(rec.value).toBe(N);
        expect(rec.cell).toEqual(Cell(CaseFileOwner(), CONSERV));
        expect(rec.kind._tag).toBe("FailedAccusation");
        if (rec.kind._tag !== "FailedAccusation") return;
        expect(rec.kind.accusationIndex).toBe(1);
        expect(rec.dependsOn).toHaveLength(2);
    });

    test("backward-compat: passing an empty accusations array is a no-op", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        k = setCell(k, Cell(CaseFileOwner(), KNIFE), Y);
        const next = failedAccusationEliminate([])(k);
        expect(next).toEqual(k);
    });
});

// -----------------------------------------------------------------------
// failedAccusationPairwiseNarrow (Tier 2)
// -----------------------------------------------------------------------

describe("failedAccusationPairwiseNarrow", () => {
    const SCARLET = cardByName(setup, "Miss Scarlet");
    const ROPE    = cardByName(setup, "Rope");
    const LIBRARY = cardByName(setup, "Library");
    const failed = (accuser: Player, cards: ReadonlyArray<Card>) =>
        Accusation({ accuser, cards });

    test("no-op when accusations is empty", () => {
        const k = failedAccusationPairwiseNarrow([], setup)(emptyKnowledge);
        expect(k).toEqual(emptyKnowledge);
    });

    test("no-op when no card is pinned to Y in the case file", () => {
        // One accusation but no pinned card — Tier 2 has nothing to
        // build on.
        const accusations = [failed(A, [PLUM, KNIFE, CONSERV])];
        const k = failedAccusationPairwiseNarrow(accusations, setup)(emptyKnowledge);
        expect(k).toEqual(emptyKnowledge);
    });

    test("forces partner=N when pinned=Y and every candidate-z is covered", () => {
        // Pin PLUM=Y. File (PLUM, KNIFE, R) for every room. Tier 2
        // should force case_KNIFE=N.
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        const accusations = rooms.map(r => failed(A, [PLUM, KNIFE, r]));
        k = failedAccusationPairwiseNarrow(accusations, setup)(k);
        expect(getCellByOwnerCard(k, CaseFileOwner(), KNIFE)).toBe(N);
    });

    test("doesn't fire if any candidate room is uncovered", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        // File for every room except CONSERV — leaves CONSERV
        // uncovered, so case file might still be (PLUM, KNIFE, CONSERV).
        const accusations = rooms
            .filter(r => r !== CONSERV)
            .map(r => failed(A, [PLUM, KNIFE, r]));
        const next = failedAccusationPairwiseNarrow(accusations, setup)(k);
        expect(getCellByOwnerCard(next, CaseFileOwner(), KNIFE)).toBeUndefined();
    });

    test("uses already-N cells to shrink the candidate set", () => {
        // Pin PLUM=Y. Every room except CONSERV and LIBRARY is N (so
        // candidates = {CONSERV, LIBRARY}). File only two accusations
        // matching those two rooms — Tier 2 should force case_KNIFE=N
        // even though most rooms aren't covered (they're already N).
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        for (const r of rooms) {
            if (r === CONSERV || r === LIBRARY) continue;
            k = setCell(k, Cell(CaseFileOwner(), r), N);
        }
        const accusations = [
            failed(A, [PLUM, KNIFE, CONSERV]),
            failed(A, [PLUM, KNIFE, LIBRARY]),
        ];
        k = failedAccusationPairwiseNarrow(accusations, setup)(k);
        expect(getCellByOwnerCard(k, CaseFileOwner(), KNIFE)).toBe(N);
    });

    test("doesn't fire when partner is already known (Y or N)", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        k = setCell(k, Cell(CaseFileOwner(), KNIFE), N);
        const accusations = rooms.map(r => failed(A, [PLUM, KNIFE, r]));
        // Already-N partner: skipped (no change).
        const next = failedAccusationPairwiseNarrow(accusations, setup)(k);
        expect(next).toEqual(k);
    });

    test("works with the symmetric ordering (case_R=Y, partner=W)", () => {
        // Pin CONSERV=Y. File (S, KNIFE, CONSERV) for every suspect
        // S. Tier 2's "pinned=CONSERV, partner=KNIFE, z-category=
        // suspects" ordering should force case_KNIFE=N.
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), CONSERV), Y);
        const accusations = suspects.map(s => failed(A, [s, KNIFE, CONSERV]));
        k = failedAccusationPairwiseNarrow(accusations, setup)(k);
        expect(getCellByOwnerCard(k, CaseFileOwner(), KNIFE)).toBe(N);
    });

    test("tracer records FailedAccusationPairwiseNarrowing kind with pinnedCard + accusationIndices", () => {
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        const accusations = rooms.map(r => failed(A, [PLUM, KNIFE, r]));
        const records: SetCellRecord[] = [];
        const tracer: Tracer = r => records.push(r);
        failedAccusationPairwiseNarrow(accusations, setup, tracer)(k);
        expect(records).toHaveLength(1);
        const rec = expectAt(records, 0);
        expect(rec.value).toBe(N);
        expect(rec.cell).toEqual(Cell(CaseFileOwner(), KNIFE));
        expect(rec.kind._tag).toBe("FailedAccusationPairwiseNarrowing");
        if (rec.kind._tag !== "FailedAccusationPairwiseNarrowing") return;
        expect(rec.kind.pinnedCard).toBe(PLUM);
        expect(rec.kind.accusationIndices).toHaveLength(rooms.length);
        // dependsOn includes pinned cell + every case-file room cell.
        expect(rec.dependsOn).toHaveLength(1 + rooms.length);
    });

    test("does NOT fire when partner is unknown but covered set is empty", () => {
        // PLUM pinned but no accusations name (PLUM, KNIFE, *) — so
        // for the (PLUM, KNIFE) ordering coveredZ is empty and the
        // rule sees no support.
        let k = emptyKnowledge;
        k = setCell(k, Cell(CaseFileOwner(), PLUM), Y);
        const accusations = [failed(A, [SCARLET, ROPE, CONSERV])];
        const next = failedAccusationPairwiseNarrow(accusations, setup)(k);
        // Nothing was forced.
        expect(getCellByOwnerCard(next, CaseFileOwner(), KNIFE)).toBeUndefined();
    });
});
