import { Effect } from "effect";
import { CLASSIC_SETUP_3P } from "../GameSetup";
import { getCardSet, getPlayerSet, makeSetupLayer } from "./index";

/**
 * End-to-end plumbing tests for the service layer. The services
 * themselves are thin accessors — the goal here is to prove that the
 * pair composes into a single Layer without DI cycles, and that an
 * `Effect.gen` yielding both returns the expected values from a
 * concrete `GameSetup`.
 *
 * Once consumer code starts `yield*`-ing these services, the existing
 * Recommender / InitialKnowledge tests become integration coverage;
 * this file is the unit-level anchor for the service boundaries.
 */
describe("game context services", () => {
    const layer = makeSetupLayer(CLASSIC_SETUP_3P);

    test("CardSetService exposes the setup's deck half", () => {
        const program = Effect.gen(function* () {
            return yield* getCardSet;
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(out.categories).toBe(CLASSIC_SETUP_3P.cardSet.categories);
    });

    test("PlayerSetService exposes the setup's roster half", () => {
        const program = Effect.gen(function* () {
            return yield* getPlayerSet;
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(out.players).toBe(CLASSIC_SETUP_3P.playerSet.players);
    });

    test("both services can be yielded side-by-side in one Effect.gen", () => {
        const program = Effect.gen(function* () {
            const cards = yield* getCardSet;
            const players = yield* getPlayerSet;
            return {
                categoryCount: cards.categories.length,
                playerCount: players.players.length,
            };
        });
        const out = Effect.runSync(program.pipe(Effect.provide(layer)));
        expect(out.categoryCount).toBe(CLASSIC_SETUP_3P.cardSet.categories.length);
        expect(out.playerCount).toBe(CLASSIC_SETUP_3P.playerSet.players.length);
    });
});
