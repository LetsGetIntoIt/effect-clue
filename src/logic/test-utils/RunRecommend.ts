import { Effect, Layer } from "effect";
import type { Accusation } from "../Accusation";
import { recommendSuggestionsByInfoGain } from "../EntropyScorer";
import type { GameSetup } from "../GameSetup";
import type { Knowledge } from "../Knowledge";
import type { Player } from "../GameObjects";
import {
    consolidateRecommendations,
    describeRecommendation,
    recommendAction,
    recommendSuggestions,
} from "../Recommender";
import type { Suggestion } from "../Suggestion";
import {
    makeAccusationsLayer,
    makeKnowledgeLayer,
    makeSetupLayer,
    makeSuggestionsLayer,
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

export const runRecommendAction = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggester: Player,
    maxResults?: number,
) =>
    Effect.runSync(
        recommendAction(suggester, maxResults).pipe(
            Effect.provide(recommendLayer(setup, knowledge)),
        ),
    );

/**
 * Test helper for the info-gain recommender. Pulls in the suggestions
 * + accusations layers in addition to setup + knowledge so the
 * Effect resolves cleanly. Both default to empty arrays for the
 * common "fresh game" test path.
 */
export const runRecommendByInfoGain = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggester: Player,
    options: {
        readonly suggestions?: ReadonlyArray<Suggestion>;
        readonly accusations?: ReadonlyArray<Accusation>;
        readonly maxResults?: number;
    } = {},
) =>
    Effect.runSync(
        recommendSuggestionsByInfoGain(
            suggester,
            options.maxResults,
        ).pipe(
            Effect.provide(
                Layer.mergeAll(
                    makeSetupLayer(setup),
                    makeKnowledgeLayer(knowledge),
                    makeSuggestionsLayer(options.suggestions ?? []),
                    makeAccusationsLayer(options.accusations ?? []),
                ),
            ),
        ),
    );
