import { HashMap, Option } from "effect";
import { describe, expect, test } from "vitest";

import { CaseFileOwner, Card, Player, PlayerOwner } from "./GameObjects";
import { emptyHypotheses, type HypothesisMap } from "./Hypothesis";
import {
    Cell,
    Knowledge,
    N as N_VAL,
    Y as Y_VAL,
    emptyKnowledge,
} from "./Knowledge";
import {
    cellKey,
    emptyUserDeductions,
    mergeHypothesesIntoUserDeductions,
    mergeUnsubstantiatedMarksIntoHypotheses,
    type UserDeductionMap,
} from "./SolverMode";

function getOrFail<K, V>(map: HashMap.HashMap<K, V>, key: K): V {
    return Option.getOrThrow(HashMap.get(map, key));
}

const ALICE = Player("Alice");
const BOB = Player("Bob");
const KNIFE = Card("knife");
const ROPE = Card("rope");
const PLUM = Card("plum");

const cellAliceKnife = Cell(PlayerOwner(ALICE), KNIFE);
const cellAliceRope = Cell(PlayerOwner(ALICE), ROPE);
const cellBobKnife = Cell(PlayerOwner(BOB), KNIFE);
const cellCasePlum = Cell(CaseFileOwner(), PLUM);

const ud = (entries: ReadonlyArray<readonly [Cell, "Y" | "N"]>): UserDeductionMap =>
    entries.reduce<UserDeductionMap>(
        (acc, [cell, v]) => HashMap.set(acc, cell, v),
        emptyUserDeductions,
    );

const hyp = (entries: ReadonlyArray<readonly [Cell, "Y" | "N"]>): HypothesisMap =>
    entries.reduce<HypothesisMap>(
        (acc, [cell, v]) => HashMap.set(acc, cell, v),
        emptyHypotheses,
    );

const knowledgeWith = (
    entries: ReadonlyArray<readonly [Cell, "Y" | "N"]>,
): Knowledge =>
    Knowledge({
        checklist: entries.reduce(
            (acc, [cell, v]) => HashMap.set(acc, cell, v),
            emptyKnowledge.checklist,
        ),
        handSizes: emptyKnowledge.handSizes,
    });

describe("mergeHypothesesIntoUserDeductions", () => {
    test("returns userDeductions unchanged when hypotheses is empty", () => {
        const userDeductions = ud([[cellAliceKnife, Y_VAL]]);
        const out = mergeHypothesesIntoUserDeductions(
            userDeductions,
            emptyHypotheses,
        );
        // HashMap iteration is a no-op; reference identity is preserved
        // because we never call HashMap.set.
        expect(out).toBe(userDeductions);
    });

    test("hypotheses-only input becomes the entire merged map", () => {
        const out = mergeHypothesesIntoUserDeductions(
            emptyUserDeductions,
            hyp([[cellAliceKnife, Y_VAL], [cellBobKnife, N_VAL]]),
        );
        expect(HashMap.size(out)).toBe(2);
        expect(getOrFail(out, cellAliceKnife)).toBe(Y_VAL);
        expect(getOrFail(out, cellBobKnife)).toBe(N_VAL);
    });

    test("disjoint cells produce the union", () => {
        const out = mergeHypothesesIntoUserDeductions(
            ud([[cellAliceKnife, Y_VAL]]),
            hyp([[cellBobKnife, N_VAL]]),
        );
        expect(HashMap.size(out)).toBe(2);
        expect(getOrFail(out, cellAliceKnife)).toBe(Y_VAL);
        expect(getOrFail(out, cellBobKnife)).toBe(N_VAL);
    });

    test("conflicting cell: hypothesis value wins", () => {
        const out = mergeHypothesesIntoUserDeductions(
            ud([[cellAliceKnife, Y_VAL]]),
            hyp([[cellAliceKnife, N_VAL]]),
        );
        expect(HashMap.size(out)).toBe(1);
        expect(getOrFail(out, cellAliceKnife)).toBe(N_VAL);
    });

    test("same value on same cell: no-op semantically (value preserved)", () => {
        const out = mergeHypothesesIntoUserDeductions(
            ud([[cellAliceKnife, Y_VAL]]),
            hyp([[cellAliceKnife, Y_VAL]]),
        );
        expect(HashMap.size(out)).toBe(1);
        expect(getOrFail(out, cellAliceKnife)).toBe(Y_VAL);
    });
});

describe("mergeUnsubstantiatedMarksIntoHypotheses", () => {
    test("empty userDeductions: returns inputs unchanged (identity)", () => {
        const hypotheses = hyp([[cellAliceKnife, Y_VAL]]);
        const order = [cellAliceKnife];
        const out = mergeUnsubstantiatedMarksIntoHypotheses(
            emptyUserDeductions,
            knowledgeWith([]),
            hypotheses,
            order,
        );
        expect(out.hypotheses).toBe(hypotheses);
        expect(out.hypothesisOrder).toBe(order);
    });

    test("substantiated mark is skipped (no change)", () => {
        const hypotheses = emptyHypotheses;
        const order: ReadonlyArray<Cell> = [];
        const knowledge = knowledgeWith([[cellAliceKnife, Y_VAL]]);
        const out = mergeUnsubstantiatedMarksIntoHypotheses(
            ud([[cellAliceKnife, Y_VAL]]),
            knowledge,
            hypotheses,
            order,
        );
        expect(out.hypotheses).toBe(hypotheses);
        expect(out.hypothesisOrder).toBe(order);
    });

    test("unsubstantiated mark is added and appended to order", () => {
        const out = mergeUnsubstantiatedMarksIntoHypotheses(
            ud([[cellAliceKnife, Y_VAL]]),
            knowledgeWith([]),
            emptyHypotheses,
            [],
        );
        expect(HashMap.size(out.hypotheses)).toBe(1);
        expect(getOrFail(out.hypotheses, cellAliceKnife)).toBe(Y_VAL);
        expect(out.hypothesisOrder).toHaveLength(1);
        expect(out.hypothesisOrder[0]).toEqual(cellAliceKnife);
    });

    test("contradicting mark (user Y, knowledge N) is unsubstantiated and added", () => {
        const out = mergeUnsubstantiatedMarksIntoHypotheses(
            ud([[cellAliceKnife, Y_VAL]]),
            knowledgeWith([[cellAliceKnife, N_VAL]]),
            emptyHypotheses,
            [],
        );
        expect(getOrFail(out.hypotheses, cellAliceKnife)).toBe(Y_VAL);
        expect(out.hypothesisOrder).toHaveLength(1);
    });

    test("knowledge === undefined: every mark counts as unsubstantiated", () => {
        const out = mergeUnsubstantiatedMarksIntoHypotheses(
            ud([
                [cellAliceKnife, Y_VAL],
                [cellBobKnife, N_VAL],
                [cellCasePlum, Y_VAL],
            ]),
            undefined,
            emptyHypotheses,
            [],
        );
        expect(HashMap.size(out.hypotheses)).toBe(3);
        expect(out.hypothesisOrder).toHaveLength(3);
    });

    test("mark already in hypotheses with different value: mark wins, order position preserved", () => {
        const priorOrder = [cellAliceKnife, cellBobKnife];
        const out = mergeUnsubstantiatedMarksIntoHypotheses(
            ud([[cellAliceKnife, N_VAL]]),
            knowledgeWith([]),
            hyp([[cellAliceKnife, Y_VAL], [cellBobKnife, Y_VAL]]),
            priorOrder,
        );
        // Mark overwrites the prior hypothesis Y → N.
        expect(getOrFail(out.hypotheses, cellAliceKnife)).toBe(N_VAL);
        // Bob untouched.
        expect(getOrFail(out.hypotheses, cellBobKnife)).toBe(Y_VAL);
        // Order: existing positions intact, nothing appended.
        expect(out.hypothesisOrder).toEqual(priorOrder);
    });

    test("multiple new marks all append AFTER existing order entries", () => {
        const priorOrder = [cellBobKnife];
        const out = mergeUnsubstantiatedMarksIntoHypotheses(
            ud([
                [cellAliceKnife, Y_VAL],
                [cellAliceRope, N_VAL],
                [cellCasePlum, Y_VAL],
            ]),
            knowledgeWith([]),
            hyp([[cellBobKnife, Y_VAL]]),
            priorOrder,
        );
        // First entry is still bob; the three new cells follow in some order.
        expect(out.hypothesisOrder[0]).toEqual(cellBobKnife);
        expect(out.hypothesisOrder).toHaveLength(4);
        const appendedKeys = new Set(
            out.hypothesisOrder.slice(1).map(cellKey),
        );
        expect(appendedKeys.has(cellKey(cellAliceKnife))).toBe(true);
        expect(appendedKeys.has(cellKey(cellAliceRope))).toBe(true);
        expect(appendedKeys.has(cellKey(cellCasePlum))).toBe(true);
    });

    test("mix of substantiated and unsubstantiated: only unsubstantiated added", () => {
        const out = mergeUnsubstantiatedMarksIntoHypotheses(
            ud([
                [cellAliceKnife, Y_VAL], // substantiated
                [cellBobKnife, N_VAL], // unsubstantiated (knowledge has no entry)
                [cellAliceRope, Y_VAL], // unsubstantiated (knowledge has different value)
            ]),
            knowledgeWith([
                [cellAliceKnife, Y_VAL],
                [cellAliceRope, N_VAL],
            ]),
            emptyHypotheses,
            [],
        );
        expect(HashMap.size(out.hypotheses)).toBe(2);
        expect(HashMap.has(out.hypotheses, cellAliceKnife)).toBe(false);
        expect(getOrFail(out.hypotheses, cellBobKnife)).toBe(N_VAL);
        expect(getOrFail(out.hypotheses, cellAliceRope)).toBe(Y_VAL);
        expect(out.hypothesisOrder).toHaveLength(2);
    });
});
