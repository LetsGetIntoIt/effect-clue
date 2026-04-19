import { Context, Effect, Layer } from "effect";
import { CardSet } from "../CardSet";

/**
 * Service-layer view of the deck half of a game. Thin wrapper over
 * `CardSet` exposing the same data through Effect's DI system so
 * downstream services (KnowledgeService, RecommendationService) can
 * `yield*` it instead of threading it as an argument.
 *
 * The existing pure-function helpers in `CardSet.ts` still work; this
 * service is additive, not a replacement. Call sites migrate
 * incrementally as they're rewritten into `Effect.gen` blocks.
 */
export class CardSetService extends Context.Service<
    CardSetService,
    {
        readonly get: () => CardSet;
    }
>()("effect-clue/CardSetService") {}

/**
 * Build a Layer providing the service from a concrete `CardSet`.
 * ClueProvider hands this layer a live snapshot on every render; the
 * cost is negligible because the `CardSet` shape is already memoised
 * upstream.
 */
export const makeCardSetLayer = (cardSet: CardSet) =>
    Layer.succeed(CardSetService)(
        CardSetService.of({ get: () => cardSet }),
    );

/** Shorthand for `yield* CardSetService` inside `Effect.gen`. */
export const getCardSet = Effect.gen(function* () {
    const svc = yield* CardSetService;
    return svc.get();
});
