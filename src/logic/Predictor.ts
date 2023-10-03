import { Data, Either, HashMap, HashSet, Match, ReadonlyArray, Tuple, pipe, Effect, Cache, Stream, Option, Number as EffectNumber, Bigint, Predicate, flow } from "effect";
import { ChecklistValue, Knowledge, updateCaseFileChecklist as updateKnowledgeCaseFileChecklist, updatePlayerChecklist as updateKnowledgePlayerChecklist } from "./Knowledge";
import { ALL_CARDS, ALL_PLAYERS, ALL_ROOM_CARDS, ALL_SUSPECT_CARDS, ALL_WEAPON_CARDS, Card, Player } from "./GameObjects";
import { deduce } from "./Deducer";
import { Suggestion } from "./Suggestion";
import { Prediction, emptyPrediction, updateCaseFileChecklist as updatePredictionCaseFileChecklist, updatePlayerChecklist as updatePredictionPlayerChecklist } from "./Prediction";
import { Probability } from "./Probability";
import { LogicalParadox } from "./LogicalParadox";

export type Predictor = (
    suggestions: HashSet.HashSet<Suggestion>,
    knowledge: Knowledge,
) => Effect.Effect<never, never, Prediction>;

export const predict: Predictor = (suggestions, knowledge) => Effect.gen(function* ($) {
    const cachedCountWaysDefinite = yield* $(Cache.make({
        capacity: Number.MAX_SAFE_INTEGER,
        timeToLive: Infinity,
        lookup: (knowledge: Knowledge) => Effect.sync(() => countWaysDefinite(knowledge)),
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
        // getNextKnowledgePossibilities(knowledge),

        Stream.mapEffect(nextPossibility => pipe(
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
        Stream.runFold(
            emptyPrediction,
            (prediction, [possibility, probability]) => updatePrediction(possibility, probability)(prediction)
        ),

        // Print out the cache stats
        Effect.tap(() => Effect.gen(function* ($) {
            const cachedCountWaysDefiniteStats = yield* $(cachedCountWaysDefinite.cacheStats());
            const cachedAllKnowledgeBranchesStats = yield* $(cachedAllKnowledgeBranches.cacheStats());
            const cachedCountWaysStats = yield* $(cachedCountWays.cacheStats());

            console.log({
                cachedCountWaysDefiniteStats,
                cachedAllKnowledgeBranchesStats,
                cachedCountWaysStats,
            });
        })),
    );
});

const countWays = (
    suggestionsAndKnowledge: Data.Data<[HashSet.HashSet<Suggestion>, Knowledge]>,
    allKnowledgeBranches: Cache.Cache<Data.Data<[HashSet.HashSet<Suggestion>, Knowledge]>, never, Stream.Stream<never, never, Knowledge>>,
    countWaysDefinite: Cache.Cache<Knowledge, never, bigint>,
): Effect.Effect<never, never, bigint> => Effect.gen(function* ($) {
    // Get all possible places the suggestions could take our knowledge
    // This function will apply deduction rules to the leaf knowledges, so we will remove as many paradoxical knowledge states as possible
    const knowledgeBranches = yield* $(allKnowledgeBranches.get(suggestionsAndKnowledge));

    return yield* $(Stream.runFoldEffect(
        knowledgeBranches,
        0n,
        (totalNumWays, knowledgeBranch) => countWaysDefinite.get(knowledgeBranch).pipe(
            // TODO can this be tail-recursion optimized? Probably not, with the cache
            Effect.map(Bigint.sum(totalNumWays)),
        ),
    ));
});

const allKnowledgeBranches = (
    [suggestions, knowledge]: Data.Data<[HashSet.HashSet<Suggestion>, Knowledge]>,
): Stream.Stream<never, never, Knowledge> => pipe(
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

    // For each suggestion, create an individual stream of the possible [refuter, card] pairs
    ReadonlyArray.map(({ cards, refuter }) => pipe(
        Stream.fromIterable(cards),
        Stream.map(card => Tuple.tuple(refuter, card))
    )),

    // Now between these, we want every possible combination of all of them
    ReadonlyArray.reduce(
        Stream.empty as Stream.Stream<never, never, [Player, Card][]>,

        // For every branch, track every [player, card] pair we have to set to get there
        (chainSoFar, nextBranches) => Stream.crossWith(
            chainSoFar,
            nextBranches,
            (chainSoFar, nextBranch) => [...chainSoFar, nextBranch]
        )
    ),

    // For each branch of possiblities, apply those changes sequentially until
    // we arrive at an end knowledge state
    // Only keep the Knowledge states we could reach without any logical paradoxes
    Stream.filterMap(flow(
        ReadonlyArray.reduce(
            Either.right(knowledge) as Either.Either<LogicalParadox, Knowledge>,
            (knowledge, [player, card]) => Either.flatMap(knowledge, updateKnowledgePlayerChecklist(
                Data.tuple(player, card),
                ChecklistValue("Y")
            ))
        ),

        // Run our deducer to maybe uncover other logical paradoxes
        Either.flatMap(deduce(suggestions)),

        // Keep only non-paradoxical knowledge states
        Either.getRight
    )),
);

const countWaysDefinite = (
    knowledge: Knowledge,
): bigint => {
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

    const numWaysToAssignCaseFile = pipe(
        caseFilePreWork,

        ReadonlyArray.map(({ numCards, numNs, numExpectedYs, numYs }) =>
            binomial(numCards - numNs, numExpectedYs - numYs),
        ),

        Bigint.multiplyAll,
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

    const numWaysToAssignPlayersWithHandSize = pipe(
        playersWithHandSize,
        ReadonlyArray.map(([player, handSize]) => {
            const { numNs, numYs } = ReadonlyArray.reduce(
                ALL_CARDS,
                { numNs: 0, numYs: 0},
                ({ numNs, numYs}, card) => {
                    const cardKnowledge = HashMap.get(knowledge.playerChecklist, Data.tuple(player, card));

                    return {
                        numNs: numNs + Option.match(cardKnowledge, {
                            onNone: () => 0,
                            onSome: cardKnowledge => (cardKnowledge === 'N' ? 1 : 0),
                        }),
                        numYs: numYs + Option.match(cardKnowledge, {
                            onNone: () => 0,
                            onSome: cardKnowledge => (cardKnowledge === 'Y' ? 1 : 0),
                        }),
                    };
                },
            );

            return binomial(
                numNs - numFreeCardsAllocatedToCaseFile,
                handSize - numYs,
            );
        }),
        Bigint.multiplyAll,
    );

    const numBlanksPlayersWithoutHandSize = pipe(
        ReadonlyArray.cartesian(
            playersWithoutHandSize,
            ALL_CARDS,
        ),
        ReadonlyArray.filter(([player, card]) => !HashMap.has(knowledge.playerChecklist, Data.tuple(player, card))),
        ReadonlyArray.length,
    );

    const numCardsLeftToAssignToPlayersWithoutHandSize =
        // How many cards are in the game
        ALL_CARDS.length
        
        // How many cards are committed to the case file
        - pipe(
            caseFilePreWork,
            ReadonlyArray.map(({ numExpectedYs }) => numExpectedYs),
            EffectNumber.sumAll,
        )

        // How many cards are committed to players with known hand size
        - pipe(
            playersWithHandSize,
            ReadonlyArray.map(Tuple.getSecond),
            EffectNumber.sumAll,
        );

    const numWaysToAssignPlayersWithoutHandSize = binomial(
        numBlanksPlayersWithoutHandSize,
        numCardsLeftToAssignToPlayersWithoutHandSize,
    );

    return numWaysToAssignAllYs
        * numWaysToAssignCaseFile
        * numWaysToAssignPlayersWithHandSize
        * numWaysToAssignPlayersWithoutHandSize;
}

// TODO make this more efficient
const binomial = (n: number, k: number): bigint =>
    factorial(n) / (factorial(n - k) * factorial(k));

// TODO make this more efficient
const factorial = (n: number): bigint =>
    BigInt(n) * factorial(n - 1);

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

const getKnowledgePossibilities = (knowledge: Knowledge): Stream.Stream<never, never, KnowledgePossibility> =>
    Stream.filter(
        allKnowledgePossibilities,

        // Only include cells that we don't know anything about
        Match.type<KnowledgePossibility>().pipe(
            Match.tagsExhaustive({
                CaseFileChecklistPossibility: ({ key }) => !HashMap.has(knowledge.caseFileChecklist, key),
                PlayerChecklistPossibility: ({ key }) => !HashMap.has(knowledge.playerChecklist, key),
            }),
        ),
    );

const allKnowledgePossibilities: Stream.Stream<never, never, KnowledgePossibility> =
    Stream.concat(
        // All possible case file checklist keys
        pipe(
            Stream.fromIterable(ALL_CARDS),
            Stream.map(card => CaseFileChecklistPossiblity({
                key: card,
            })),
        ),

        // All possible player checklist keys
        pipe(
            Stream.cross(
                Stream.fromIterable(ALL_PLAYERS),
                Stream.fromIterable(ALL_CARDS),
            ),
            Stream.map(Data.array),
            Stream.map(playerCard => PlayerChecklistPossibility({
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
