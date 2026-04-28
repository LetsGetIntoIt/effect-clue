import { Context, Effect, Layer } from "effect";
import type { Accusation } from "../Accusation";

/**
 * Service-layer view of the current session's logged failed
 * accusations. The deducer reads this to apply
 * `failedAccusationEliminate` — every prior accusation that didn't
 * win is now public information about what the case file *isn't*.
 *
 * Reads only; mutations still go through the React reducer. The
 * layer is rebuilt on every render to reflect the latest snapshot.
 */
export class AccusationsService extends Context.Service<
    AccusationsService,
    {
        readonly get: () => ReadonlyArray<Accusation>;
    }
>()("effect-clue/AccusationsService") {}

export const makeAccusationsLayer = (
    accusations: ReadonlyArray<Accusation>,
) =>
    Layer.succeed(AccusationsService)(
        AccusationsService.of({ get: () => accusations }),
    );

/** Shorthand for `yield* AccusationsService` inside `Effect.gen`. */
export const getAccusations = Effect.gen(function* () {
    const svc = yield* AccusationsService;
    return svc.get();
});
