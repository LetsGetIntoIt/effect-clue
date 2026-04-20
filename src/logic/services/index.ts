import { Layer } from "effect";
import type { GameSetup } from "../GameSetup";
import type { Knowledge } from "../Knowledge";
import type { Suggestion } from "../Suggestion";
import {
    CardSetService,
    getCardSet,
    makeCardSetLayer,
} from "./CardSetService";
import {
    KnowledgeService,
    getKnowledge,
    makeKnowledgeLayer,
} from "./KnowledgeService";
import {
    PlayerSetService,
    getPlayerSet,
    makePlayerSetLayer,
} from "./PlayerSetService";
import {
    SuggestionsService,
    getSuggestions,
    makeSuggestionsLayer,
} from "./SuggestionsService";

export { CardSetService, getCardSet, makeCardSetLayer };
export { PlayerSetService, getPlayerSet, makePlayerSetLayer };
export { SuggestionsService, getSuggestions, makeSuggestionsLayer };
export { KnowledgeService, getKnowledge, makeKnowledgeLayer };

/**
 * Layer providing the two static-per-session halves of a game setup.
 * `yield*` CardSetService + PlayerSetService inside an Effect.gen
 * and reconstruct the composite with `GameSetup({ cardSet, playerSet })`
 * if needed.
 */
export const makeSetupLayer = (setup: GameSetup) =>
    Layer.mergeAll(
        makeCardSetLayer(setup.cardSet),
        makePlayerSetLayer(setup.playerSet),
    );

/**
 * Full layer for anything that needs to read ambient session state:
 * the deck, the roster, the suggestion log, and the current deduced
 * Knowledge. Used by the Recommender and by the traced deduction
 * path in ClueDerived.
 *
 * Each field is a read-only snapshot; the layer is rebuilt every
 * time the reducer produces new state so consumers always see a
 * consistent view.
 */
export const makeClueLayer = (input: {
    readonly setup: GameSetup;
    readonly suggestions: ReadonlyArray<Suggestion>;
    readonly knowledge: Knowledge;
}) =>
    Layer.mergeAll(
        makeSetupLayer(input.setup),
        makeSuggestionsLayer(input.suggestions),
        makeKnowledgeLayer(input.knowledge),
    );
