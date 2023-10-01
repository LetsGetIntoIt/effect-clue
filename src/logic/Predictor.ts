import { Data, Either, HashMap, HashSet, Match, Number, Option, ReadonlyArray, Tuple, pipe } from "effect";
import { tupled } from "effect/Function";
import { ChecklistValue, Knowledge, updateCaseFileChecklist as updateKnowledgeCaseFileChecklist, updatePlayerChecklist as updateKnowledgePlayerChecklist } from "./Knowledge";
import { ALL_CARDS, ALL_PLAYERS, Card, Player } from "./GameObjects";
import deducer from "./Deducer";
import { Suggestion } from "./Suggestion";
import { Prediction, emptyPrediction, updateCaseFileChecklist as updatePredictionCaseFileChecklist, updatePlayerChecklist as updatePredictionPlayerChecklist } from "./Prediction";
import { Probability } from "./Probability";
import { LogicalParadox } from "./LogicalParadox";

export const predict = (
    suggestions: HashSet.HashSet<Suggestion>,
) => (
    knowledge: Knowledge,
): Prediction => {
    // Count the number of ways our current knowledge is possible
    const currentKnowledgeNumWays = countWays(suggestions)(knowledge);

    // For each blank key, see how many ways we can get a Y there
    return pipe(

        // Get all the knowledge possiblities for which we want to determine probability
        allKnowledgePossibilities,
        // getNextKnowledgePossibilities(knowledge),

        ReadonlyArray.map(nextPossibility => Tuple.tuple(
            nextPossibility,

            pipe(
                // Set this possiblity to a Y and count how many ways it's possible
                updateKnowledge(nextPossibility, ChecklistValue("Y"))(knowledge),
                Either.match({
                    // There was an immediate logical paradox, so this state is not possible
                    onLeft: () => 0,

                    // Count how many ways this is possible
                    onRight: countWays(suggestions),
                }),

                // Save these results as a probability for this key
                possibleYNumWays => Probability(possibleYNumWays, currentKnowledgeNumWays),
            ),
        )),

        // Build our map of predictions
        ReadonlyArray.reduce(
            emptyPrediction,
            (prediction, [possibility, probability]) =>
                updatePrediction(possibility, probability)(prediction),
        ),
    );
}

const countWays = (
    suggestions: HashSet.HashSet<Suggestion>,
) => (
    knowledge: Knowledge,
): number => pipe(
    // Get the next blank key to set to a value
    getKnowledgePossibilities(knowledge),
    ReadonlyArray.head,

    Option.match({
        // If there is no next blank key, then we've filled in everything!
        // That means there's exactly 1 way to have this arrangement
        onNone: () => 1,

        // Otherwise, try all possible values
        onSome: (nextPossibility) => pipe(
            // List the possible values we can assign to the blank key
            [ChecklistValue("Y"), ChecklistValue("N")],

            // Update our knowledge by setting that value
            ReadonlyArray.map(value => updateKnowledge(nextPossibility, value)(knowledge)),
            // We only care about non-paradoxical states
            ReadonlyArray.filterMap(Either.getRight),

            // For each of these valid knowledge states, deduce as much definite knowledge as possible
            ReadonlyArray.map(deducer(suggestions)),
            // We only care about non-paradoxical states
            ReadonlyArray.filterMap(Either.getRight),

            // Recurse into all these possible states, and sum up the number of ways they are possible
            ReadonlyArray.map(countWays(suggestions)),
            Number.sumAll,
        ),
    }),
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

const getKnowledgePossibilities = (knowledge: Knowledge): readonly KnowledgePossibility[] =>
    pipe(
        allKnowledgePossibilities,

        // Only include cells that we don't know anything about
        ReadonlyArray.filter(Match.type<KnowledgePossibility>().pipe(
            Match.tagsExhaustive({
                CaseFileChecklistPossibility: ({ key }) => !HashMap.has(knowledge.caseFileChecklist, key),
                PlayerChecklistPossibility: ({ key }) => !HashMap.has(knowledge.playerChecklist, key),
            }),
        )),
    );

const allKnowledgePossibilities: readonly KnowledgePossibility[] =
    ReadonlyArray.appendAll(
        // All possible case file checklist keys
        ReadonlyArray.map(ALL_CARDS, card => CaseFileChecklistPossiblity({
            key: card,
        })),

        // All possible player checklist keys
        pipe(
            ReadonlyArray.cartesian(ALL_PLAYERS, ALL_CARDS),
            ReadonlyArray.map(tupled(Data.tuple)),
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
