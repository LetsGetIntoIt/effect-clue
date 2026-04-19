import { Effect } from "effect";
import { CLASSIC_SETUP_3P } from "../GameSetup";
import { getCardSet } from "./CardSetService";
import {
    GameSetupService,
    makeGameSetupLayer,
} from "./GameSetupService";
import { getPlayerSet } from "./PlayerSetService";

/**
 * End-to-end plumbing tests for the service layer introduced in
 * Phase 3.4. The services themselves are thin accessors — the goal
 * here is to prove that
 *
 *  (a) the three services compose into a single Layer without DI
 *      cycles, and
 *  (b) an `Effect.gen` that reads all three returns the expected
 *      values from a concrete `GameSetup`, confirming the composite
 *      `GameSetupService` correctly pulls from the two halves.
 *
 * Once consumer code starts `yield*`-ing these services, the
 * existing Recommender / InitialKnowledge tests become integration
 * coverage; this file is the unit-level anchor for the service
 * boundaries.
 */
describe("game context services", () => {
    const layer = makeGameSetupLayer(CLASSIC_SETUP_3P);

    test("CardSetService exposes the composite's deck half", () => {
        const program = Effect.gen(function* () {
            return yield* getCardSet;
        });
        const out = Effect.runSync(
            program.pipe(Effect.provide(layer)),
        );
        expect(out.categories).toBe(CLASSIC_SETUP_3P.cardSet.categories);
    });

    test("PlayerSetService exposes the composite's roster half", () => {
        const program = Effect.gen(function* () {
            return yield* getPlayerSet;
        });
        const out = Effect.runSync(
            program.pipe(Effect.provide(layer)),
        );
        expect(out.players).toBe(CLASSIC_SETUP_3P.playerSet.players);
    });

    test("GameSetupService combines both halves", () => {
        const program = Effect.gen(function* () {
            const svc = yield* GameSetupService;
            const owners = svc.allOwners();
            const hands = svc.defaultHandSizes();
            return { ownerCount: owners.length, hands };
        });
        const out = Effect.runSync(
            program.pipe(Effect.provide(layer)),
        );
        // 3 players + case file = 4 owners.
        expect(out.ownerCount).toBe(4);
        // Every player gets the deck's dealt size; exact values come
        // from defaultHandSizes which we're intentionally exercising
        // through the service rather than re-stating them here.
        expect(out.hands.length).toBe(3);
    });
});
