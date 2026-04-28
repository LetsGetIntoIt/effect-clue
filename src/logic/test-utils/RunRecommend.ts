import { Effect, Layer } from "effect";
import type { Accusation } from "../Accusation";
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
 * builds one layer per render and uses it across all calls.
 *
 * `recommendSuggestions` reads suggestions + accusations + setup +
 * knowledge from services, so the helper now accepts both as
 * optional parameters. Default to empty arrays so the existing
 * "fresh game" test calls still work without churn.
 */

const recommendLayer = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggestions: ReadonlyArray<Suggestion>,
    accusations: ReadonlyArray<Accusation>,
) =>
    Layer.mergeAll(
        makeSetupLayer(setup),
        makeKnowledgeLayer(knowledge),
        makeSuggestionsLayer(suggestions),
        makeAccusationsLayer(accusations),
    );

export const runRecommend = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggester: Player,
    maxResults?: number,
    options: {
        readonly suggestions?: ReadonlyArray<Suggestion>;
        readonly accusations?: ReadonlyArray<Accusation>;
    } = {},
) =>
    Effect.runSync(
        recommendSuggestions(suggester, maxResults).pipe(
            Effect.provide(
                recommendLayer(
                    setup,
                    knowledge,
                    options.suggestions ?? [],
                    options.accusations ?? [],
                ),
            ),
        ),
    );

export const runConsolidate = (
    setup: GameSetup,
    knowledge: Knowledge,
    recs: Parameters<typeof consolidateRecommendations>[0],
) =>
    Effect.runSync(
        consolidateRecommendations(recs).pipe(
            Effect.provide(recommendLayer(setup, knowledge, [], [])),
        ),
    );

export const runDescribe = (
    setup: GameSetup,
    knowledge: Knowledge,
    r: Parameters<typeof describeRecommendation>[0],
) =>
    Effect.runSync(
        describeRecommendation(r).pipe(
            Effect.provide(recommendLayer(setup, knowledge, [], [])),
        ),
    );

export const runRecommendAction = (
    setup: GameSetup,
    knowledge: Knowledge,
    suggester: Player,
    maxResults?: number,
    options: {
        readonly suggestions?: ReadonlyArray<Suggestion>;
        readonly accusations?: ReadonlyArray<Accusation>;
    } = {},
) =>
    Effect.runSync(
        recommendAction(suggester, maxResults).pipe(
            Effect.provide(
                recommendLayer(
                    setup,
                    knowledge,
                    options.suggestions ?? [],
                    options.accusations ?? [],
                ),
            ),
        ),
    );
