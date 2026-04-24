import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect } from "effect";
import { CardSet } from "../CardSet";
import { CLASSIC_SETUP_3P } from "../GameSetup";
import {
    CardSetService,
    getCardSet,
    makeCardSetLayer,
} from "./CardSetService";

// -----------------------------------------------------------------------
// The services under test are thin read-only accessors: each one wraps
// a data snapshot and exposes it through `get`. Tests use
// `@effect/vitest`'s `it.effect` helper so the per-test boilerplate
// stays minimal — no `Effect.runSync` wrapping, no `.pipe(Effect.provide)`
// dance noise at the call site.
// -----------------------------------------------------------------------

describe("CardSetService", () => {
    const classicLayer = makeCardSetLayer(CLASSIC_SETUP_3P.cardSet);

    it.effect("yields the provided CardSet via `getCardSet`", () =>
        Effect.gen(function* () {
            const cs = yield* getCardSet;
            expect(cs).toBe(CLASSIC_SETUP_3P.cardSet);
        }).pipe(Effect.provide(classicLayer)),
    );

    it.effect("exposes the categories on the returned CardSet", () =>
        Effect.gen(function* () {
            const cs = yield* getCardSet;
            expect(cs.categories.map(c => c.name)).toEqual([
                "Suspect",
                "Weapon",
                "Room",
            ]);
        }).pipe(Effect.provide(classicLayer)),
    );

    it.effect("reads the same snapshot on every `yield*`", () =>
        Effect.gen(function* () {
            const a = yield* getCardSet;
            const b = yield* getCardSet;
            expect(a).toBe(b);
        }).pipe(Effect.provide(classicLayer)),
    );

    it.effect("a different layer provides a different CardSet", () => {
        const empty = CardSet({ categories: [] });
        return Effect.gen(function* () {
            const cs = yield* getCardSet;
            expect(cs).toBe(empty);
            expect(cs.categories).toHaveLength(0);
        }).pipe(Effect.provide(makeCardSetLayer(empty)));
    });

    it.effect("exposes the same data through CardSetService directly", () =>
        Effect.gen(function* () {
            const svc = yield* CardSetService;
            expect(svc.get()).toBe(CLASSIC_SETUP_3P.cardSet);
        }).pipe(Effect.provide(classicLayer)),
    );
});
