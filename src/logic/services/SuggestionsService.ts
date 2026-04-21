import { Context, Effect, Layer } from "effect";
import type { Suggestion } from "../Suggestion";

/**
 * Service-layer view of the current session's logged suggestions.
 * The deducer and its traced cousin read this instead of taking
 * suggestions as an argument — the suggestions array is ambient
 * context for any computation that walks the rule chain.
 *
 * Reads only; mutations still go through the React reducer. The
 * layer is rebuilt on every render to reflect the latest snapshot.
 */
export class SuggestionsService extends Context.Service<
    SuggestionsService,
    {
        readonly get: () => ReadonlyArray<Suggestion>;
    }
>()("effect-clue/SuggestionsService") {}

export const makeSuggestionsLayer = (
    suggestions: ReadonlyArray<Suggestion>,
) =>
    Layer.succeed(SuggestionsService)(
        SuggestionsService.of({ get: () => suggestions }),
    );

/** Shorthand for `yield* SuggestionsService` inside `Effect.gen`. */
export const getSuggestions = Effect.gen(function* () {
    const svc = yield* SuggestionsService;
    return svc.get();
});
