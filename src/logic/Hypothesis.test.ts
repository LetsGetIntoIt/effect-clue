import { HashMap, Result } from "effect";
import { describe, expect, test } from "vitest";
import { CaseFileOwner, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    computeHypothesisConflict,
    displayFor,
    emptyHypotheses,
    foldHypothesesInto,
    statusFor,
    type HypothesisMap,
} from "./Hypothesis";
import { Cell, emptyKnowledge, Knowledge, N, setCell, Y } from "./Knowledge";
import { Player } from "./GameObjects";
import { cardByName } from "./test-utils/CardByName";
import type { ContradictionTrace } from "./Deducer";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const SCARLET = cardByName(setup, "Miss Scarlet");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

const cellAScarlet = Cell(PlayerOwner(A), SCARLET);
const cellBScarlet = Cell(PlayerOwner(B), SCARLET);
const cellCaseFileScarlet = Cell(CaseFileOwner(), SCARLET);
const cellAKnife = Cell(PlayerOwner(A), KNIFE);
const cellBKnife = Cell(PlayerOwner(B), KNIFE);
const cellBKitchen = Cell(PlayerOwner(B), KITCHEN);

const dummyTrace: ContradictionTrace = {
    reason: "test",
    offendingCells: [],
    offendingSuggestionIndices: [],
    offendingAccusationIndices: [],
    sliceLabel: "test",
    contradictionKind: undefined,
};

const hypothesisMap = (
    entries: ReadonlyArray<readonly [Cell, "Y" | "N"]>,
): HypothesisMap => {
    let m: HypothesisMap = emptyHypotheses;
    for (const [cell, value] of entries) m = HashMap.set(m, cell, value);
    return m;
};

describe("foldHypothesesInto", () => {
    test("empty map returns the input knowledge unchanged", () => {
        const result = foldHypothesesInto(emptyKnowledge, emptyHypotheses);
        expect(Result.isSuccess(result)).toBe(true);
        if (Result.isSuccess(result)) {
            expect(result.success).toBe(emptyKnowledge);
        }
    });

    test("hypothesis matching an existing initial cell is a no-op", () => {
        const initial: Knowledge = setCell(emptyKnowledge, cellAScarlet, Y);
        const result = foldHypothesesInto(
            initial,
            hypothesisMap([[cellAScarlet, Y]]),
        );
        expect(Result.isSuccess(result)).toBe(true);
    });

    test("hypothesis disagreeing with an existing initial cell returns Failure", () => {
        const initial: Knowledge = setCell(emptyKnowledge, cellAScarlet, Y);
        const result = foldHypothesesInto(
            initial,
            hypothesisMap([[cellAScarlet, N]]),
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
            expect(result.failure.offendingCells).toContainEqual(cellAScarlet);
        }
    });

    test("multiple compatible hypotheses fold cleanly", () => {
        const result = foldHypothesesInto(
            emptyKnowledge,
            hypothesisMap([
                [cellAScarlet, Y],
                [cellBScarlet, N],
            ]),
        );
        expect(Result.isSuccess(result)).toBe(true);
    });
});

describe("statusFor", () => {
    test("undefined real knowledge → suppress to off", () => {
        expect(
            statusFor(
                cellAScarlet,
                undefined,
                undefined,
                hypothesisMap([[cellAScarlet, Y]]),
                false,
            ).kind,
        ).toBe("off");
    });

    test("no hypothesis on cell, real proves nothing, joint absent → off", () => {
        const real = emptyKnowledge;
        expect(
            statusFor(
                cellAScarlet,
                real,
                undefined,
                emptyHypotheses,
                false,
            ).kind,
        ).toBe("off");
    });

    test("active: hypothesis on a cell real doesn't yet prove, joint succeeds", () => {
        const real = emptyKnowledge;
        const joint = setCell(emptyKnowledge, cellAScarlet, Y);
        const status = statusFor(
            cellAScarlet,
            real,
            joint,
            hypothesisMap([[cellAScarlet, Y]]),
            false,
        );
        expect(status.kind).toBe("active");
        if (status.kind === "active") expect(status.value).toBe(Y);
    });

    test("confirmed: real proves the hypothesis right", () => {
        const real = setCell(emptyKnowledge, cellAScarlet, Y);
        expect(
            statusFor(
                cellAScarlet,
                real,
                undefined,
                hypothesisMap([[cellAScarlet, Y]]),
                false,
            ).kind,
        ).toBe("confirmed");
    });

    test("directlyContradicted: real proves the opposite", () => {
        const real = setCell(emptyKnowledge, cellAScarlet, Y);
        const status = statusFor(
            cellAScarlet,
            real,
            undefined,
            hypothesisMap([[cellAScarlet, N]]),
            false,
        );
        expect(status.kind).toBe("directlyContradicted");
        if (status.kind === "directlyContradicted") {
            expect(status.real).toBe(Y);
            expect(status.hypothesis).toBe(N);
        }
    });

    test("jointlyConflicts: hypothesis on cell, joint deduction failed", () => {
        const real = emptyKnowledge;
        expect(
            statusFor(
                cellAScarlet,
                real,
                undefined,
                hypothesisMap([[cellAScarlet, Y]]),
                true,
            ).kind,
        ).toBe("jointlyConflicts");
    });

    test("derived: no direct hypothesis, joint deduction proves a value real doesn't", () => {
        const real = emptyKnowledge;
        const joint = setCell(emptyKnowledge, cellCaseFileScarlet, N);
        // The hypothesis lives on a different cell — this cell's value
        // arises from deduction over the augmented set.
        const status = statusFor(
            cellCaseFileScarlet,
            real,
            joint,
            hypothesisMap([[cellAScarlet, Y]]),
            false,
        );
        expect(status.kind).toBe("derived");
        if (status.kind === "derived") expect(status.value).toBe(N);
    });
});

describe("displayFor", () => {
    test("real value wins over hypothesis", () => {
        expect(
            displayFor(Y, { kind: "directlyContradicted", hypothesis: N, real: Y }),
        ).toEqual({ tag: "real", value: Y });
    });

    test("hypothesis with no real → hypothesis tag (renders ?)", () => {
        expect(displayFor(undefined, { kind: "active", value: Y })).toEqual({
            tag: "hypothesis",
            value: Y,
        });
    });

    test("derived → derived tag", () => {
        expect(
            displayFor(undefined, { kind: "derived", value: N }),
        ).toEqual({ tag: "derived", value: N });
    });

    test("off + no real → blank", () => {
        expect(displayFor(undefined, { kind: "off" })).toEqual({
            tag: "blank",
        });
    });
});

describe("computeHypothesisConflict", () => {
    test("undefined joint deduction → no banner (no hypotheses active)", () => {
        const real = Result.succeed(emptyKnowledge);
        expect(
            computeHypothesisConflict(real, undefined, emptyHypotheses),
        ).toBeUndefined();
    });

    test("joint deduction succeeded → no banner (hypotheses are coherent)", () => {
        const real = Result.succeed(emptyKnowledge);
        const joint = Result.succeed(
            setCell(emptyKnowledge, cellAKnife, Y),
        );
        expect(
            computeHypothesisConflict(
                real,
                joint,
                hypothesisMap([[cellAKnife, Y]]),
            ),
        ).toBeUndefined();
    });

    test("real-only deduction itself failing → suppress (defer to global banner)", () => {
        const real = Result.fail(dummyTrace);
        const joint = Result.fail(dummyTrace);
        expect(
            computeHypothesisConflict(
                real,
                joint,
                hypothesisMap([[cellAKnife, Y]]),
            ),
        ).toBeUndefined();
    });

    test("one hypothesis disagrees with a real fact → directly-contradicted with that single entry", () => {
        // Real says A owns Knife (Y). Hypothesis says A doesn't (N).
        const real = Result.succeed(setCell(emptyKnowledge, cellAKnife, Y));
        const joint = Result.fail(dummyTrace);
        const out = computeHypothesisConflict(
            real,
            joint,
            hypothesisMap([[cellAKnife, N]]),
        );
        expect(out?.kind).toBe("directly-contradicted");
        expect(out?.entries).toHaveLength(1);
        expect(out?.entries[0]?.cell).toEqual(cellAKnife);
        expect(out?.entries[0]?.value).toBe(N);
    });

    test("directly-contradicted wins over jointly-conflicting AND filters to only contradicted entries", () => {
        // A ⊢ KNIFE=Y (real). Hypothesis 1: A doesn't own Knife (N) →
        // direct contradiction. Hypothesis 2: B owns Kitchen (Y) → on
        // its own, plausible. Banner takes the directly-contradicted
        // path AND lists only the contradicted entry; the still-
        // plausible one doesn't belong in this banner copy.
        const real = Result.succeed(setCell(emptyKnowledge, cellAKnife, Y));
        const joint = Result.fail(dummyTrace);
        const out = computeHypothesisConflict(
            real,
            joint,
            hypothesisMap([
                [cellAKnife, N],
                [cellBKitchen, Y],
            ]),
        );
        expect(out?.kind).toBe("directly-contradicted");
        expect(out?.entries).toHaveLength(1);
        expect(out?.entries[0]?.cell).toEqual(cellAKnife);
    });

    test("joint fails but no hypothesis directly contradicts → jointly-conflicting with all entries", () => {
        // Real has nothing. Hypotheses say A AND B both own Knife —
        // each is plausible alone, but together they violate
        // exactly-one-owner. Joint fails; no direct real contradiction.
        const real = Result.succeed(emptyKnowledge);
        const joint = Result.fail(dummyTrace);
        const out = computeHypothesisConflict(
            real,
            joint,
            hypothesisMap([
                [cellAKnife, Y],
                [cellBKnife, Y],
            ]),
        );
        expect(out?.kind).toBe("jointly-conflicting");
        expect(out?.entries).toHaveLength(2);
        const cells = out?.entries.map(e => e.cell) ?? [];
        expect(cells).toContainEqual(cellAKnife);
        expect(cells).toContainEqual(cellBKnife);
    });

    test("joint fails but hypothesis map is empty → undefined (defensive)", () => {
        // Defensive branch: in production callers short-circuit before
        // reaching here when the map is empty, but the function should
        // still behave correctly if invoked with an empty map.
        const real = Result.succeed(emptyKnowledge);
        const joint = Result.fail(dummyTrace);
        expect(
            computeHypothesisConflict(real, joint, emptyHypotheses),
        ).toBeUndefined();
    });
});
