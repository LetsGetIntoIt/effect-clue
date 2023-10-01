import { Data, Either, HashMap, Match, Number, Option, ReadonlyArray, Tuple, pipe } from "effect";
import { compose, tupled } from "effect/Function";
import { ChecklistValue, Knowledge, LogicalParadox, updateCaseFileChecklist, updatePlayerChecklist } from "./Knowledge";
import { ALL_CARDS, ALL_PLAYERS, Card, Player } from "./GameObjects";
import deducer from "./Deducer";

export const countWays = (knowledge: Knowledge): number => Option.match(
    // Get the next blank key to set to a value
    getNextBlankKey(knowledge),

    {
        // If there is no next blank key, then we've filled in everything!
        // That means there's exactly 1 way to have this arrangement
        onNone: () => 1,

        // Otherwise, try all possible values
        onSome: (nextBlankKey) => pipe(
            // List the possible values we can assign to the blank key
            // TODO: do we need to try both values, or is setting Ys enough?
            [ChecklistValue("Y"), ChecklistValue("N")],

            // Update our knowledge by setting that value
            ReadonlyArray.map(value => updateKnowledge(nextBlankKey, value)(knowledge)),
            // We only care about non-paradoxical states
            compose(ReadonlyArray.separate, Tuple.getSecond),

            // For each of these valid knowledge states, deduce as much definite knowledge as possible
            ReadonlyArray.map(deducer),
            // We only care about non-paradoxical states
            compose(ReadonlyArray.separate, Tuple.getSecond),

            // Recurse into all these possible states, and sum up the number of ways they are possible
            ReadonlyArray.map(countWays),
            Number.sumAll,
        ),
    },
);

type KnowledgeKey = CaseFileChecklistKey | PlayerChecklistKey;

interface CaseFileChecklistKey extends Data.Case {
    _tag: "CaseFileChecklistKey";
    key: Card;
}

const CaseFileChecklistKey = (key: Card) => Data.tagged<CaseFileChecklistKey>("CaseFileChecklistKey")({
    key,
});

interface PlayerChecklistKey extends Data.Case {
    _tag: "PlayerChecklistKey";
    key: Data.Data<[Player, Card]>;
}

const PlayerChecklistKey = (key: Data.Data<[Player, Card]>) => Data.tagged<PlayerChecklistKey>("PlayerChecklistKey")({
    key,
});

export const getNextBlankKey = (knowledge: Knowledge): Option.Option<KnowledgeKey> =>
    Option.orElse(
        // Try blank case file keys
        pipe(
            ALL_CARDS,
            ReadonlyArray.findFirst(card => !HashMap.has(knowledge.caseFileChecklist, card)),
            Option.map(CaseFileChecklistKey),
        ),

        // Try blank player checklist keys
        () => pipe(
            ReadonlyArray.cartesian(ALL_PLAYERS, ALL_CARDS),
            ReadonlyArray.map(tupled(Data.tuple)),
            ReadonlyArray.findFirst(playerCard => !HashMap.has(knowledge.playerChecklist, playerCard)),
            Option.map(PlayerChecklistKey),
        ),
    );

export const updateKnowledge = (key: KnowledgeKey, value: "Y" | "N"): (knowledge: Knowledge) => Either.Either<LogicalParadox, Knowledge> =>
    Match.value(key).pipe(
        Match.tagsExhaustive({
            CaseFileChecklistKey: ({ key }) => updateCaseFileChecklist(key, value),
            PlayerChecklistKey: ({ key }) => updatePlayerChecklist(key, value),
        }),
    );
