import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect } from "effect";
import { Player } from "../GameObjects";
import { CLASSIC_SETUP_3P } from "../GameSetup";
import { cardByName } from "../test-utils/CardByName";
import { Accusation, newAccusationId } from "../Accusation";
import {
    AccusationsService,
    getAccusations,
    makeAccusationsLayer,
} from "./AccusationsService";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

const makeAccusation = (accuser = A) =>
    Accusation({
        id: newAccusationId(),
        accuser,
        cards: [MUSTARD, KNIFE, KITCHEN],
    });

describe("AccusationsService", () => {
    it.effect("yields an empty list when no accusations are provided", () =>
        Effect.gen(function* () {
            const accusations = yield* getAccusations;
            expect(accusations).toEqual([]);
        }).pipe(Effect.provide(makeAccusationsLayer([]))),
    );

    it.effect("yields the provided accusations in order", () => {
        const list = [makeAccusation(A), makeAccusation(B)];
        return Effect.gen(function* () {
            const accusations = yield* getAccusations;
            expect(accusations).toHaveLength(2);
            expect(accusations[0]?.accuser).toBe(A);
            expect(accusations[1]?.accuser).toBe(B);
        }).pipe(Effect.provide(makeAccusationsLayer(list)));
    });

    it.effect("returns the same array reference on every yield", () => {
        const list = [makeAccusation()];
        return Effect.gen(function* () {
            const a = yield* getAccusations;
            const b = yield* getAccusations;
            expect(a).toBe(b);
        }).pipe(Effect.provide(makeAccusationsLayer(list)));
    });

    it.effect("providing a different layer swaps the log", () => {
        const first = [makeAccusation(A)];
        const second = [makeAccusation(A), makeAccusation(B)];
        return Effect.gen(function* () {
            const accusations = yield* getAccusations;
            expect(accusations).toBe(second);
            expect(accusations).not.toBe(first);
        }).pipe(Effect.provide(makeAccusationsLayer(second)));
    });

    it.effect("exposes the same data through AccusationsService directly", () => {
        const list = [makeAccusation()];
        return Effect.gen(function* () {
            const svc = yield* AccusationsService;
            expect(svc.get()).toBe(list);
        }).pipe(Effect.provide(makeAccusationsLayer(list)));
    });
});
