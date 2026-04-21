import { Effect, Layer, Result } from "effect";
import type { GameSetup } from "../GameSetup";
import type { Knowledge } from "../Knowledge";
import type { Provenance } from "../Provenance";
import type { Suggestion } from "../Suggestion";
import deduce, {
    type ContradictionTrace,
    type DeductionResult,
} from "../Deducer";
import { deduceWithExplanations } from "../Provenance";
import {
    makeSetupLayer,
    makeSuggestionsLayer,
} from "../services";

/**
 * Synchronous convenience wrappers for the Effect-ful deducer APIs.
 * Only used from tests — production callers (state.tsx) build and
 * share a layer across the full set of useMemos, so they don't need
 * this per-call ceremony.
 */

const deduceLayer = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
) =>
    Layer.mergeAll(
        makeSetupLayer(setup),
        makeSuggestionsLayer(suggestions),
    );

/**
 * Test helper: runs `deduce` through an ephemeral layer and
 * materialises the Effect failure channel back to a `Result`. Tests
 * keep their existing `Result.isSuccess` / `Result.isFailure`
 * assertion style; the channel switch happens at the boundary.
 */
export const runDeduce = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    initial: Knowledge,
): DeductionResult =>
    Effect.runSync(
        Effect.result(deduce(initial)).pipe(
            Effect.provide(deduceLayer(setup, suggestions)),
        ),
    );

export const runDeduceWithExplanations = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    initial: Knowledge,
): Result.Result<
    { knowledge: Knowledge; provenance: Provenance },
    ContradictionTrace
> =>
    Effect.runSync(
        Effect.result(deduceWithExplanations(initial)).pipe(
            Effect.provide(deduceLayer(setup, suggestions)),
        ),
    );
