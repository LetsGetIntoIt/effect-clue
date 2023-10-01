import { Data, Either, HashMap, HashSet, Match, Number, Option, ReadonlyArray, Tuple, pipe } from "effect";
import { compose, tupled } from "effect/Function";
import { ChecklistValue, Knowledge, LogicalParadox, updateCaseFileChecklist, updatePlayerChecklist } from "./Knowledge";
import { ALL_CARDS, ALL_PLAYERS, Card, Player } from "./GameObjects";
import deducer from "./Deducer";
import { Suggestion } from "./Suggestion";

export const countWays = (
    suggestions: HashSet.HashSet<Suggestion>,
) => (
    knowledge: Knowledge,
): number => Option.match(
    // Get the next blank key to set to a value
    getNextKnowledgePossibility(knowledge),

    {
        // If there is no next blank key, then we've filled in everything!
        // That means there's exactly 1 way to have this arrangement
        onNone: () => 1,

        // Otherwise, try all possible values
        onSome: (nextBlankKey) => pipe(
            // List the possible values we can assign to the blank key
            [ChecklistValue("Y"), ChecklistValue("N")],

            // Update our knowledge by setting that value
            ReadonlyArray.map(value => updateKnowledge(nextBlankKey, value)(knowledge)),
            // We only care about non-paradoxical states
            compose(ReadonlyArray.separate, Tuple.getSecond),

            // For each of these valid knowledge states, deduce as much definite knowledge as possible
            ReadonlyArray.map(deducer(suggestions)),
            // We only care about non-paradoxical states
            compose(ReadonlyArray.separate, Tuple.getSecond),

            // Recurse into all these possible states, and sum up the number of ways they are possible
            ReadonlyArray.map(countWays(suggestions)),
            Number.sumAll,
        ),
    },
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

export const getNextKnowledgePossibility = (knowledge: Knowledge): Option.Option<KnowledgePossibility> =>
    Option.orElse(
        // Try blank case file keys
        pipe(
            ALL_CARDS,
            ReadonlyArray.findFirst(card => !HashMap.has(knowledge.caseFileChecklist, card)),
            Option.map(card => CaseFileChecklistPossiblity({
                key: card,
            })),
        ),

        // Try blank player checklist keys
        () => pipe(
            ReadonlyArray.cartesian(ALL_PLAYERS, ALL_CARDS),
            ReadonlyArray.map(tupled(Data.tuple)),
            ReadonlyArray.findFirst(playerCard => !HashMap.has(knowledge.playerChecklist, playerCard)),
            Option.map(playerCard => PlayerChecklistPossibility({
                key: playerCard,
            })),
        ),
    );

export const updateKnowledge = (key: KnowledgePossibility, value: "Y" | "N"): (knowledge: Knowledge) => Either.Either<LogicalParadox, Knowledge> =>
    Match.value(key).pipe(
        Match.tagsExhaustive({
            CaseFileChecklistPossibility: ({ key }) => updateCaseFileChecklist(key, value),
            PlayerChecklistPossibility: ({ key }) => updatePlayerChecklist(key, value),
        }),
    );
