import { Data, Either, HashMap, HashSet, Match, Number as EffectNumber, ReadonlyArray, Tuple, pipe, Effect, Cache, Stream, Chunk } from "effect";
import { ChecklistValue, Knowledge, updateCaseFileChecklist as updateKnowledgeCaseFileChecklist, updatePlayerChecklist as updateKnowledgePlayerChecklist } from "./Knowledge";
import { ALL_CARDS, ALL_PLAYERS, Card, Player } from "./GameObjects";
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
    const countWaysGivenSuggestions = countWays(suggestions);

    const countWaysGivenSuggestionsAndCache: Cache.Cache<Knowledge, never, number> = yield* $(Cache.make({
        capacity: Number.MAX_SAFE_INTEGER,
        timeToLive: Infinity,
        lookup: (knowledge: Knowledge) =>
            countWaysGivenSuggestions(knowledge, countWaysGivenSuggestionsAndCache),
    }));

    // Count the number of ways our current knowledge is possible
    const currentKnowledgeNumWays = yield* $(countWaysGivenSuggestionsAndCache.get(knowledge));

    // For each blank key, see how many ways we can get a Y there
    return yield* $(
        // Get all the knowledge possiblities for which we want to determine probability
        allKnowledgePossibilitiesSync,
        // // Get all the BLANK knowledge possiblities for which we want to determine probability
        // // Use this if we want to save some resources calculating the whole thing
        // getNextKnowledgePossibilities(knowledge),

        ReadonlyArray.map(nextPossibility => pipe(
            // Set this possiblity to a Y and count how many ways it's possible
            updateKnowledge(nextPossibility, ChecklistValue("Y"))(knowledge),

            // Count the number of ways this next state can occur
            Either.match({
                // There was an immediate logical paradox, so this state is not possible
                onLeft: () => Effect.succeed(0),

                // Count how many ways this is possible
                onRight: knowledge => countWaysGivenSuggestionsAndCache.get(knowledge),
            }),

            // Convert this count to a probability, associated with the key
            Effect.map(possibleYNumWays => Tuple.tuple(
                nextPossibility,
                Probability(possibleYNumWays, currentKnowledgeNumWays),
            )),
        )),

        allPossibilityCases => Effect.all(allPossibilityCases, { concurrency: 'inherit' }),

        // Build our map of predictions
        Effect.map(ReadonlyArray.reduce(
            emptyPrediction,
            (prediction, [possibility, probability]) => updatePrediction(possibility, probability)(prediction)
        )),

        // Print out the cache stats
        Effect.tap(() => Effect.gen(function* ($) {
            const stats = yield* $(countWaysGivenSuggestionsAndCache.cacheStats());
            console.log(stats);
        })),
    );
});

const countWays = (
    suggestions: HashSet.HashSet<Suggestion>,
) => (
    knowledge: Knowledge,
    cachedSelf: Cache.Cache<Knowledge, never, number>
): Effect.Effect<never, never, number> => pipe(
    // Get all the blank keys
    getKnowledgePossibilities(knowledge),

    // List all the possible values we can set for those blank cells
    Stream.cross(
        Stream.fromIterable([ChecklistValue("Y"), ChecklistValue("N")]),
    ),

    // Update our knowledge to set those values
    Stream.map(([possibility, value]) => updateKnowledge(possibility, value)(knowledge)),
    // Keep only the non-paradoxical resulting states
    Stream.filterMap(Either.getRight),

    // For each of these valid knowledge states, deduce as much definite knowledge as possible
    Stream.map(deduce(suggestions)),
    // Keep only the non-paradoxical resulting states
    Stream.filterMap(Either.getRight),

    // Recurse into each of these valid states
    Stream.runFoldEffect(
        0, // There are initially no valid ways to arrive at the initial knowledge state
        (totalNumWays, knowledge) => cachedSelf.get(knowledge).pipe(
            Effect.map(EffectNumber.sum(totalNumWays)),
        ),
    ),
);

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

// TODO remove this
const allKnowledgePossibilitiesSync: readonly KnowledgePossibility[] =
    Effect.runSync(Stream.runCollect(allKnowledgePossibilities).pipe(
        Effect.map(Chunk.toReadonlyArray),
    ));

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
