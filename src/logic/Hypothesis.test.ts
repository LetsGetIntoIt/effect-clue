import { HashMap, Result } from "effect";
import { describe, expect, test } from "vitest";
import { CaseFileOwner, PlayerOwner } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import {
    displayFor,
    emptyHypotheses,
    foldHypothesesInto,
    statusFor,
    type HypothesisMap,
} from "./Hypothesis";
import { Cell, emptyKnowledge, Knowledge, N, setCell, Y } from "./Knowledge";
import { Player } from "./GameObjects";
import { cardByName } from "./test-utils/CardByName";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const SCARLET = cardByName(setup, "Miss Scarlet");

const cellAScarlet = Cell(PlayerOwner(A), SCARLET);
const cellBScarlet = Cell(PlayerOwner(B), SCARLET);
const cellCaseFileScarlet = Cell(CaseFileOwner(), SCARLET);

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
