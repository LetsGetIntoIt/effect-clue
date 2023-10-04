import { Data, Either, HashMap, HashSet, Match, ReadonlyArray, Tuple, pipe, Effect, Cache, Option, Number as EffectNumber, Bigint, Equal } from "effect";
import { ChecklistValue, Knowledge, updateCaseFileChecklist as updateKnowledgeCaseFileChecklist, updatePlayerChecklist as updateKnowledgePlayerChecklist } from "./Knowledge";
import { Card, GameObjects, Player } from "./GameObjects";
import { deduce } from "./Deducer";
import { Suggestion } from "./Suggestion";
import { Prediction, emptyPrediction, updateCaseFileChecklist as updatePredictionCaseFileChecklist, updatePlayerChecklist as updatePredictionPlayerChecklist } from "./Prediction";
import { Probability } from "./Probability";
import { LogicalParadox } from "./LogicalParadox";
import { Combinatorics, combinatoricsLive } from "./utils/Combinatorics";

export type Predictor = (
    gameObjects: GameObjects,
    suggestions: HashSet.HashSet<Suggestion>,
    knowledge: Knowledge,
) => Effect.Effect<never, never, Prediction>;

type PredictorLookupKey = Data.Data<[GameObjects, HashSet.HashSet<Suggestion>, Knowledge]>;

export const predict: Predictor = (gameObjects, suggestions, knowledge) => Effect.gen(function* ($) {
    const cachedCountWays: Cache.Cache<PredictorLookupKey, never, bigint> = yield* $(Cache.make({
        capacity: Number.MAX_SAFE_INTEGER,
        timeToLive: Infinity,
        lookup: (key: PredictorLookupKey) => countWays(key, cachedCountWays),
    }));

    const currentKnowledgeNumWays = yield* $(cachedCountWays.get(Data.tuple(gameObjects, suggestions, knowledge)));

    // For each blank key, see how many ways we can get a Y there
    return yield* $(
        // Get all the knowledge possiblities for which we want to determine probability
        allKnowledgePossibilities(gameObjects),
        // // Get all the BLANK knowledge possiblities for which we want to determine probability
        // // Use this if we want to save some resources calculating the whole thing
        // getKnowledgePossibilities(knowledge),

        ReadonlyArray.map(nextPossibility => pipe(
            // Set this possiblity to a Y and count how many ways it's possible
            updateKnowledge(nextPossibility, ChecklistValue("Y"))(knowledge),

            // Count the number of ways this next state can occur
            Either.match({
                // There was an immediate logical paradox, so this state is not possible
                onLeft: () => Effect.succeed(0n),

                // Count how many ways this is possible
                onRight: knowledge => cachedCountWays.get(Data.tuple(gameObjects, suggestions, knowledge)),
            }),

            // Convert this count to a probability, associated with the key
            Effect.map(possibleYNumWays => Tuple.tuple(
                nextPossibility,
                Probability(possibleYNumWays, currentKnowledgeNumWays),
            )),
        )),

        // Build our map of predictions
        recursiveCases => Effect.all(recursiveCases, { concurrency: 'inherit' }),
        Effect.map(ReadonlyArray.reduce(
            emptyPrediction,
            (prediction, [possibility, probability]) => updatePrediction(possibility, probability)(prediction)
        )),

        // Print out the cache stats
        Effect.tap(() => Effect.gen(function* ($) {
            const combinatorics = yield* $(Combinatorics);

            const combinatoricsStats = yield* $(combinatorics.cacheStats());
            const cachedCountWaysStats = yield* $(cachedCountWays.cacheStats());

            console.log({
                combinatoricsStats,
                cachedCountWaysStats,
            });
        })),
    );
}).pipe(
    Effect.provideLayer(combinatoricsLive),
);

const countWays = (
    [gameObjects, suggestions, knowledge]: PredictorLookupKey,
    cachedSelf: Cache.Cache<PredictorLookupKey, never, bigint>,
): Effect.Effect<Combinatorics, never, bigint> => Effect.gen(function* ($) {
    // First, run our hardcoded deductions to learn as much as we can
    // Particularly, we rely on:
    // - Every row with a Y should have N's everywhere else
    // - Every non-refuter has been assigned an N for the suggested cards
    const advancedKnowledgeEither = deduce(gameObjects)(suggestions)(knowledge);
    if (Either.isLeft(advancedKnowledgeEither)) {
        // There was a paradox! That means this state is impossible
        return 0n;
    }
    const advancedKnowledge = advancedKnowledgeEither.right;
    // If we've learned something new, recursively call the cached version of this
    // function. That ensures the ensuing result will be cached for both the input
    // knowledge and the futher-deduced knowledge
    if (!Equal.equals(knowledge, advancedKnowledge)) {
        return yield* $(cachedSelf.get(Data.tuple(gameObjects, suggestions, advancedKnowledge)));
    }
    // Otherwise, the input knowledge is advanced as possible, so we can continue

    // Now that we've run our deductions, count the number of ways there are to
    // assign all the known Ys in the checklist (this is easy - it's just 1)
    const numWaysToAssignAllYs = 1n;

    const { binomial } = yield* $(Combinatorics);

    const caseFilePreWork = pipe(
        HashMap.values(gameObjects.cardsByCategory),
        ReadonlyArray.fromIterable,

        ReadonlyArray.map(HashSet.reduce(
            {
                numCards: 0,
                numNs: 0,
                numExpectedYs: 1,
                numYs: 0,
            },

            ({ numCards, numNs, numExpectedYs, numYs }, card) => {
                const cardKnowledge = HashMap.get(knowledge.caseFileChecklist, card);

                return {
                    numCards: numCards + 1,
                    numNs: numNs + Option.match(cardKnowledge, {
                        onNone: () => 0,
                        onSome: cardKnowledge => (cardKnowledge === 'N' ? 1 : 0),
                    }),
                    numExpectedYs,
                    numYs: numYs + Option.match(cardKnowledge, {
                        onNone: () => 0,
                        onSome: cardKnowledge => (cardKnowledge === 'Y' ? 1 : 0),
                    }),
                };
            }
        )),
    );

    const numWaysToAssignCaseFile = yield* $(
        caseFilePreWork,

        Effect.reduce(
            1n,
            (total, { numCards, numNs, numExpectedYs, numYs}) =>
                binomial(numCards - numNs, numExpectedYs - numYs).pipe(
                    Effect.map(Bigint.multiply(total)),
                ),
        ),
    );

    const numFreeCardsAllocatedToCaseFile = pipe(
        caseFilePreWork,
        
        ReadonlyArray.map(({ numExpectedYs, numYs }) =>
            numExpectedYs - numYs,
        ),

        EffectNumber.sumAll,
    );

    const [playersWithoutHandSize, playersWithHandSize] = pipe(
        gameObjects.players,
        HashSet.map(player => pipe(
            HashMap.get(knowledge.playerHandSize, player),
            Either.fromOption(() => player),
            Either.map(handSize => Tuple.tuple(player, handSize)),
        )),
        ReadonlyArray.separate,
    );

    const numWaysToAssignPlayersWithHandSize = yield* $(
        playersWithHandSize,

        ReadonlyArray.map(([player, handSize]) => ReadonlyArray.reduce(
            gameObjects.cards,
            { handSize, numNs: 0, numYs: 0 },
            ({ handSize, numNs, numYs }, card) => {
                const cardKnowledge = HashMap.get(knowledge.playerChecklist, Data.tuple(player, card));

                return {
                    handSize,
                    numNs: numNs + Option.match(cardKnowledge, {
                        onNone: () => 0,
                        onSome: cardKnowledge => (cardKnowledge === 'N' ? 1 : 0),
                    }),
                    numYs: numYs + Option.match(cardKnowledge, {
                        onNone: () => 0,
                        onSome: cardKnowledge => (cardKnowledge === 'Y' ? 1 : 0),
                    }),
                };
            }
        )),

        Effect.reduce(
            1n,
            (total, { numNs, handSize, numYs }) =>
                binomial(
                    numNs - numFreeCardsAllocatedToCaseFile,
                    handSize - numYs,
                ).pipe(
                    Effect.map(Bigint.multiply(total)),
                ),
        ),
    );

    const numBlanksPlayersWithoutHandSize = pipe(
        ReadonlyArray.cartesian(
            playersWithoutHandSize,
            ReadonlyArray.fromIterable(gameObjects.cards),
        ),
        ReadonlyArray.filter(([player, card]) => !HashMap.has(knowledge.playerChecklist, Data.tuple(player, card))),
        ReadonlyArray.length,
    );

    const numCardsLeftToAssignToPlayersWithoutHandSize = pipe(
        // How many cards are in the game
        HashSet.size(gameObjects.cards),

        // How many cards are committed to the case file
        EffectNumber.subtract(pipe(
            caseFilePreWork,
            ReadonlyArray.map(({ numExpectedYs }) => numExpectedYs),
            EffectNumber.sumAll,
        )),

        // How many cards are committed to players with known hand size
        EffectNumber.subtract(pipe(
            playersWithHandSize,
            ReadonlyArray.map(Tuple.getSecond),
            EffectNumber.sumAll,
        )),
    );

    const numWaysToAssignPlayersWithoutHandSize = yield* $(binomial(
        numBlanksPlayersWithoutHandSize,
        numCardsLeftToAssignToPlayersWithoutHandSize,
    ));

    return numWaysToAssignAllYs
        * numWaysToAssignCaseFile
        * numWaysToAssignPlayersWithHandSize
        * numWaysToAssignPlayersWithoutHandSize;
});

type KnowledgePossibility = CaseFileChecklistPossibility | PlayerChecklistPossibility;

interface CaseFileChecklistPossibility extends Data.Case {
    _tag: "CaseFileChecklistPossibility";
    key: Card;
}

const CaseFileChecklistPossiblity = Data.tagged<CaseFileChecklistPossibility>("CaseFileChecklistPossibility");

interface PlayerChecklistPossibility extends Data.Case {
    _tag: "PlayerChecklistPossibility";
    key: Data.Data<[Player, Card]>;
}

const PlayerChecklistPossibility =  Data.tagged<PlayerChecklistPossibility>("PlayerChecklistPossibility");

const allKnowledgePossibilities = (gameObjects: GameObjects): readonly KnowledgePossibility[] =>
    ReadonlyArray.appendAll(
        // All possible case file checklist keys
        pipe(
            gameObjects.cards,
            HashSet.map(card => CaseFileChecklistPossiblity({
                key: card,
            })),
        ),

        // All possible player checklist keys
        pipe(
            ReadonlyArray.cartesian(
                ReadonlyArray.fromIterable(gameObjects.players),
                ReadonlyArray.fromIterable(gameObjects.cards),
            ),
            ReadonlyArray.map(Data.array),
            ReadonlyArray.map(playerCard => PlayerChecklistPossibility({
                key: playerCard,
            })),
        ),
    );

const updateKnowledge = (key: KnowledgePossibility, value: "Y" | "N"): (knowledge: Knowledge) => Either.Either<LogicalParadox, Knowledge> =>
    Match.value(key).pipe(
        Match.tagsExhaustive({
            CaseFileChecklistPossibility: ({ key }) => updateKnowledgeCaseFileChecklist(key, value),
            PlayerChecklistPossibility: ({ key }) => updateKnowledgePlayerChecklist(key, value),
        }),
    );

const updatePrediction = (key: KnowledgePossibility, value: Probability): (prediction: Prediction) => Prediction =>
    Match.value(key).pipe(
        Match.tagsExhaustive({
            CaseFileChecklistPossibility: ({ key }) => updatePredictionCaseFileChecklist(key, value),
            PlayerChecklistPossibility: ({ key }) => updatePredictionPlayerChecklist(key, value),
        }),
    );
