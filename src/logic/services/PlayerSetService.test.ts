import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect } from "effect";
import { CLASSIC_SETUP_3P } from "../GameSetup";
import { Player } from "../GameObjects";
import { PlayerSet } from "../PlayerSet";
import {
    getPlayerSet,
    makePlayerSetLayer,
    PlayerSetService,
} from "./PlayerSetService";

describe("PlayerSetService", () => {
    const classicLayer = makePlayerSetLayer(CLASSIC_SETUP_3P.playerSet);

    it.effect("yields the provided PlayerSet via `getPlayerSet`", () =>
        Effect.gen(function* () {
            const ps = yield* getPlayerSet;
            expect(ps).toBe(CLASSIC_SETUP_3P.playerSet);
        }).pipe(Effect.provide(classicLayer)),
    );

    it.effect("exposes the players array on the returned PlayerSet", () =>
        Effect.gen(function* () {
            const ps = yield* getPlayerSet;
            expect(ps.players).toBe(CLASSIC_SETUP_3P.playerSet.players);
        }).pipe(Effect.provide(classicLayer)),
    );

    it.effect("a different layer provides a different roster", () => {
        const custom = PlayerSet({
            players: [Player("Anisha"), Player("Bob")],
        });
        return Effect.gen(function* () {
            const ps = yield* getPlayerSet;
            expect(ps).toBe(custom);
            expect(ps.players).toHaveLength(2);
        }).pipe(Effect.provide(makePlayerSetLayer(custom)));
    });

    it.effect("an empty roster is a valid layer input", () => {
        const empty = PlayerSet({ players: [] });
        return Effect.gen(function* () {
            const ps = yield* getPlayerSet;
            expect(ps.players).toEqual([]);
        }).pipe(Effect.provide(makePlayerSetLayer(empty)));
    });

    it.effect("exposes the same data through PlayerSetService directly", () =>
        Effect.gen(function* () {
            const svc = yield* PlayerSetService;
            expect(svc.get()).toBe(CLASSIC_SETUP_3P.playerSet);
        }).pipe(Effect.provide(classicLayer)),
    );
});
