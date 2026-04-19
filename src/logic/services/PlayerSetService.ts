import { Context, Effect, Layer } from "effect";
import { PlayerSet } from "../PlayerSet";

/**
 * Service-layer view of the player roster. Mirrors `CardSetService`
 * for the `PlayerSet` half of the game. Thin accessor — no behaviour
 * beyond exposing the current snapshot so downstream Effect code can
 * `yield*` it.
 */
export class PlayerSetService extends Context.Service<
    PlayerSetService,
    {
        readonly get: () => PlayerSet;
    }
>()("effect-clue/PlayerSetService") {}

export const makePlayerSetLayer = (playerSet: PlayerSet) =>
    Layer.succeed(PlayerSetService)(
        PlayerSetService.of({ get: () => playerSet }),
    );

/** Shorthand for `yield* PlayerSetService` inside `Effect.gen`. */
export const getPlayerSet = Effect.gen(function* () {
    const svc = yield* PlayerSetService;
    return svc.get();
});
