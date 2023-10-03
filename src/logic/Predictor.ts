import { Data, Either, HashMap, HashSet, Match, ReadonlyArray, Tuple, pipe, Effect, Cache, Stream, Option, Number as EffectNumber, Bigint, Predicate, flow } from "effect";
import { ChecklistValue, Knowledge, updateCaseFileChecklist as updateKnowledgeCaseFileChecklist, updatePlayerChecklist as updateKnowledgePlayerChecklist } from "./Knowledge";
import { ALL_CARDS, ALL_PLAYERS, ALL_ROOM_CARDS, ALL_SUSPECT_CARDS, ALL_WEAPON_CARDS, Card, Player } from "./GameObjects";
import { deduce } from "./Deducer";
import { Suggestion } from "./Suggestion";
import { Prediction, emptyPrediction, updateCaseFileChecklist as updatePredictionCaseFileChecklist, updatePlayerChecklist as updatePredictionPlayerChecklist } from "./Prediction";
import { Probability } from "./Probability";
import { LogicalParadox } from "./LogicalParadox";
import { Combinatorics, combinatoricsLive } from "./utils/Combinatorics";

export type Predictor = (
    suggestions: HashSet.HashSet<Suggestion>,
    knowledge: Knowledge,
) => Effect.Effect<never, never, Prediction>;

export const predict: Predictor = (suggestions, knowledge) => Effect.gen(function* ($) {
    const cachedCountWaysDefinite = yield* $(Cache.make({
        capacity: Number.MAX_SAFE_INTEGER,
        timeToLive: Infinity,
        lookup: (knowledge: Knowledge) => countWaysDefinite(knowledge),
    }));

    const cachedAllKnowledgeBranches = yield* $(Cache.make({
        capacity: Number.MAX_SAFE_INTEGER,
        timeToLive: Infinity,
        lookup: (suggestionsAndKnowledge: Data.Data<[HashSet.HashSet<Suggestion>, Knowledge]>) =>
            Effect.sync(() => allKnowledgeBranches(suggestionsAndKnowledge)),
    }));

    const cachedCountWays = yield* $(Cache.make({
        capacity: Number.MAX_SAFE_INTEGER,
        timeToLive: Infinity,
        lookup: (suggestionsAndKnowledge: Data.Data<[HashSet.HashSet<Suggestion>, Knowledge]>) =>
            countWays(suggestionsAndKnowledge, cachedAllKnowledgeBranches, cachedCountWaysDefinite),
    }));

    const currentKnowledgeNumWays = yield* $(cachedCountWays.get(Data.tuple(suggestions, knowledge)));

    // For each blank key, see how many ways we can get a Y there
    return yield* $(
        // Get all the knowledge possiblities for which we want to determine probability
        allKnowledgePossibilities,
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
                onRight: knowledge => cachedCountWays.get(Data.tuple(suggestions, knowledge)),
            }),

            // Convert this count to a probability, associated with the key
            Effect.map(possibleYNumWays => Tuple.tuple(
                nextPossibility,
                Probability(possibleYNumWays, currentKnowledgeNumWays),
            )),
        )),

        // // Build our map of predictions
        Effect.all,
        Effect.map(ReadonlyArray.reduce(
            emptyPrediction,
            (prediction, [possibility, probability]) => updatePrediction(possibility, probability)(prediction)
        )),

        // Print out the cache stats
        Effect.tap(() => Effect.gen(function* ($) {
            const combinatorics = yield* $(Combinatorics);

            const combinatoricsStats = yield* $(combinatorics.cacheStats());
            const cachedCountWaysDefiniteStats = yield* $(cachedCountWaysDefinite.cacheStats());
            const cachedAllKnowledgeBranchesStats = yield* $(cachedAllKnowledgeBranches.cacheStats());
            const cachedCountWaysStats = yield* $(cachedCountWays.cacheStats());

            console.log({
                combinatoricsStats,
                cachedCountWaysDefiniteStats,
                cachedAllKnowledgeBranchesStats,
                cachedCountWaysStats,
            });
        })),
    );
}).pipe(
    Effect.provideLayer(combinatoricsLive),
);

const countWays = (
    [suggestions, knowledge]: Data.Data<[HashSet.HashSet<Suggestion>, Knowledge]>,
    allKnowledgeBranches: Cache.Cache<Data.Data<[HashSet.HashSet<Suggestion>, Knowledge]>, never, readonly Knowledge[]>,
    countWaysDefinite: Cache.Cache<Knowledge, never, bigint>,
): Effect.Effect<never, never, bigint> => pipe(
    // Get all possible places the suggestions could take our knowledge
    allKnowledgeBranches.get(Data.tuple(suggestions, knowledge)),

    // Maximally deduce the knowledge
    // Our counter relies on this
    Effect.map(ReadonlyArray.filterMap(flow(
        deduce(suggestions),
        // Discard any paradoxical knowledge states 
        Either.getRight,
    ))),

    Effect.flatMap(Effect.reduce(
        0n,
        (totalNumWays, knowledgeBranch) => countWaysDefinite.get(knowledgeBranch).pipe(
            // TODO can this be tail-recursion optimized? Probably not, with the cache
            Effect.map(Bigint.sum(totalNumWays)),
        ),
    )),
);

const allKnowledgeBranches = (
    [suggestions, knowledge]: Data.Data<[HashSet.HashSet<Suggestion>, Knowledge]>,
): readonly Knowledge[] => pipe(
    HashSet.values(suggestions),

    // We only want suggestions that were refuted with an unknown card
    ReadonlyArray.filterMap(({ cards, refuter, seenCard }) => {
        if (Predicate.isNotNullable(refuter) && Predicate.isNullable(seenCard)) {
            return Option.some({
                cards,
                refuter,
            });
        }

        return Option.none();
    }),

    // If there are no such suggestions, then we don't need to branch! We're already at the leaf node
    Option.liftPredicate(ReadonlyArray.isNonEmptyArray),
    Option.match({
        onNone: () => ReadonlyArray.of(knowledge),

        onSome: flow(
            // For each suggestion, create an individual stream of the possible [refuter, card] pairs
            ReadonlyArray.map(({ cards, refuter }) => pipe(
                cards,
                HashSet.map(card => Tuple.tuple(refuter, card)),
            )),

            // Now between these, we want every possible combination of all of them
            ReadonlyArray.reduce(
                ReadonlyArray.empty<[Player, Card][]>(), 

                // For every branch, track every [player, card] pair we have to set to get there
                (allChainsSoFar, nextBranches) => ReadonlyArray.cartesianWith(
                    allChainsSoFar,
                    ReadonlyArray.fromIterable(nextBranches),
                    (chainSoFar, nextBranch) => ReadonlyArray.append(chainSoFar, nextBranch),
                ),
            ),

            // For each branch of possiblities, apply those changes sequentially until
            // we arrive at an end knowledge state
            // Only keep the Knowledge states we could reach without any logical paradoxes
            ReadonlyArray.filterMap(flow(
                ReadonlyArray.reduce(
                    Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,
                    (knowledge, [player, card]) => Either.flatMap(knowledge, updateKnowledgePlayerChecklist(
                        Data.tuple(player, card),
                        ChecklistValue("Y")
                    ))
                ),

                // Keep only non-paradoxical knowledge states
                Either.getRight
            )),
        ),
    }),
);

const countWaysDefinite = (
    knowledge: Knowledge,
): Effect.Effect<Combinatorics, never, bigint> => Effect.gen(function* ($) {
    const { binomial } = yield* $(Combinatorics);

    // Assume that the given knowledge has been deduced as much as possible
    // Particularly, we rely on:
    // - Every row with a Y should have N's everywhere else
    // - Every non-refuter has been assigned an N for the suggested cards
    const numWaysToAssignAllYs = 1n;

    const caseFilePreWork = ReadonlyArray.map(
        [ALL_SUSPECT_CARDS, ALL_WEAPON_CARDS, ALL_ROOM_CARDS],

        ReadonlyArray.reduce(
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
        ),
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
        ALL_PLAYERS,
        ReadonlyArray.map(player => pipe(
            HashMap.get(knowledge.playerHandSize, player),
            Either.fromOption(() => player),
            Either.map(handSize => Tuple.tuple(player, handSize)),
        )),
        ReadonlyArray.separate,
    );

    const numWaysToAssignPlayersWithHandSize = yield* $(
        playersWithHandSize,

        ReadonlyArray.map(([player, handSize]) => ReadonlyArray.reduce(
            ALL_CARDS,
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
            ALL_CARDS,
        ),
        ReadonlyArray.filter(([player, card]) => !HashMap.has(knowledge.playerChecklist, Data.tuple(player, card))),
        ReadonlyArray.length,
    );

    const numCardsLeftToAssignToPlayersWithoutHandSize = pipe(
        // How many cards are in the game
        ALL_CARDS.length,

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

const getKnowledgePossibilities = (knowledge: Knowledge): readonly KnowledgePossibility[] =>
    ReadonlyArray.filter(
        allKnowledgePossibilities,

        // Only include cells that we don't know anything about
        Match.type<KnowledgePossibility>().pipe(
            Match.tagsExhaustive({
                CaseFileChecklistPossibility: ({ key }) => !HashMap.has(knowledge.caseFileChecklist, key),
                PlayerChecklistPossibility: ({ key }) => !HashMap.has(knowledge.playerChecklist, key),
            }),
        ),
    );

const allKnowledgePossibilities: readonly KnowledgePossibility[] =
    ReadonlyArray.appendAll(
        // All possible case file checklist keys
        pipe(
            ALL_CARDS,
            ReadonlyArray.map(card => CaseFileChecklistPossiblity({
                key: card,
            })),
        ),

        // All possible player checklist keys
        pipe(
            ReadonlyArray.cartesian(ALL_PLAYERS, ALL_CARDS),
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
