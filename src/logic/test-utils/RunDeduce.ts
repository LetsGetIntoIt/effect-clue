import { Effect, Layer } from "effect";
import type { GameSetup } from "../GameSetup";
import type { Knowledge } from "../Knowledge";
import type { Provenance } from "../Provenance";
import type { Suggestion } from "../Suggestion";
import deduce, { type DeductionResult } from "../Deducer";
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

export const runDeduce = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    initial: Knowledge,
): DeductionResult =>
    Effect.runSync(
        deduce(initial).pipe(Effect.provide(deduceLayer(setup, suggestions))),
    );

export const runDeduceWithExplanations = (
    setup: GameSetup,
    suggestions: ReadonlyArray<Suggestion>,
    initial: Knowledge,
): { knowledge: Knowledge; provenance: Provenance } =>
    Effect.runSync(
        deduceWithExplanations(initial).pipe(
            Effect.provide(deduceLayer(setup, suggestions)),
        ),
    );
