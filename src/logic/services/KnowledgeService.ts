import { Context, Effect, Layer } from "effect";
import type { Knowledge } from "../Knowledge";

/**
 * Service-layer view of the currently-deduced Knowledge — the
 * checklist state after the deducer has run. Recommender consumers
 * (recommendSuggestions, consolidateRecommendations,
 * describeRecommendation) read this as ambient context instead of
 * threading `knowledge` through every call.
 *
 * Consumers that want the pre-deduction initial knowledge build it
 * directly via `buildInitialKnowledge(setup, knownCards, handSizes)`
 * — this service is for the output side, not the inputs.
 *
 * Reads only; the layer is rebuilt each render to reflect the
 * latest memoised deduction result.
 */
export class KnowledgeService extends Context.Service<
    KnowledgeService,
    {
        readonly get: () => Knowledge;
    }
>()("effect-clue/KnowledgeService") {}

export const makeKnowledgeLayer = (knowledge: Knowledge) =>
    Layer.succeed(KnowledgeService)(
        KnowledgeService.of({ get: () => knowledge }),
    );

/** Shorthand for `yield* KnowledgeService` inside `Effect.gen`. */
export const getKnowledge = Effect.gen(function* () {
    const svc = yield* KnowledgeService;
    return svc.get();
});
