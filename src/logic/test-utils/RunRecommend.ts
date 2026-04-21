import { Effect, Layer } from "effect";
import type { GameSetup } from "../GameSetup";
import type { Knowledge } from "../Knowledge";
import type { Player } from "../GameObjects";
import {
    consolidateRecommendations,
    describeRecommendation,
    recommendSuggestions,
} from "../Recommender";
import {
    makeKnowledgeLayer,
    makeSetupLayer,
} from "../services";

/**
 * Synchronous convenience wrappers for the Effect-ful recommender
 * APIs. Only used from tests — the SuggestionLogPanel consumer
 * builds one layer per render and uses it across all three calls.
 */

const recommendLayer = (setup: GameSetup, knowledge: Knowledge) =>
    Layer.mergeAll(makeSetupLayer(setup), makeKnowledgeLayer(knowledge));

export const runRecommend = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggester: Player,
    maxResults?: number,
) =>
    Effect.runSync(
        recommendSuggestions(suggester, maxResults).pipe(
            Effect.provide(recommendLayer(setup, knowledge)),
        ),
    );

export const runConsolidate = (
    setup: GameSetup,
    knowledge: Knowledge,
    recs: Parameters<typeof consolidateRecommendations>[0],
) =>
    Effect.runSync(
        consolidateRecommendations(recs).pipe(
            Effect.provide(recommendLayer(setup, knowledge)),
        ),
    );

export const runDescribe = (
    setup: GameSetup,
    knowledge: Knowledge,
    r: Parameters<typeof describeRecommendation>[0],
) =>
    Effect.runSync(
        describeRecommendation(r).pipe(
            Effect.provide(recommendLayer(setup, knowledge)),
        ),
    );
