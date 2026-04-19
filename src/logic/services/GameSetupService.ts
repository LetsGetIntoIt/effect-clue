import { Context, Effect, Layer } from "effect";
import {
    allOwners,
    defaultHandSizes,
    GameSetup,
} from "../GameSetup";
import { Owner, Player } from "../GameObjects";
import {
    CardSetService,
    makeCardSetLayer,
} from "./CardSetService";
import {
    makePlayerSetLayer,
    PlayerSetService,
} from "./PlayerSetService";

/**
 * Composite service for the two operations that genuinely need both
 * halves of a `GameSetup`: owner enumeration (players ∪ caseFile) and
 * default hand-size math (dealt cards ÷ player count). Depends on
 * `CardSetService` + `PlayerSetService` so the upstream layers can
 * provide the halves independently (useful when the deck is stable
 * but players churn, e.g. after Task 3's preset split).
 */
export class GameSetupService extends Context.Service<
    GameSetupService,
    {
        readonly get: () => GameSetup;
        readonly allOwners: () => ReadonlyArray<Owner>;
        readonly defaultHandSizes: () => ReadonlyArray<
            readonly [Player, number]
        >;
    }
>()("effect-clue/GameSetupService") {}

/**
 * Service-layer implementation that reads both halves via their own
 * services. Local to this module — callers use `makeGameSetupLayer`
 * below, which stitches all three services together.
 */
const gameSetupLive = Layer.effect(GameSetupService)(
    Effect.gen(function* () {
        const cards = yield* CardSetService;
        const players = yield* PlayerSetService;
        const get = (): GameSetup =>
            GameSetup({
                cardSet: cards.get(),
                playerSet: players.get(),
            });
        return GameSetupService.of({
            get,
            allOwners: () => allOwners(get()),
            defaultHandSizes: () => defaultHandSizes(get()),
        });
    }),
);

/**
 * One-stop layer: provides all three services backed by a concrete
 * `GameSetup`. Use this from `ClueProvider` on every render so React
 * consumers that opt into Effect get a live view of the reducer state.
 */
export const makeGameSetupLayer = (setup: GameSetup) =>
    gameSetupLive.pipe(
        Layer.provideMerge(
            Layer.mergeAll(
                makeCardSetLayer(setup.cardSet),
                makePlayerSetLayer(setup.playerSet),
            ),
        ),
    );

