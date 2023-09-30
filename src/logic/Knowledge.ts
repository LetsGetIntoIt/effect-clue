import { Data, Either, Equal, HashMap, HashSet, Match, Option, Struct, pipe } from "effect";
import { Card, Player } from "./GameObjects";
import { Suggestion } from "./Suggestion";
import { modifyAtOrFail } from "./utils/Effect";

export const ChecklistValue = (value: "Y" | "N"): "Y" | "N" => value;

export type Knowledge = Data.Data<{
    playerChecklist: HashMap.HashMap<
        Data.Data<[Player, Card]>,
        "Y" | "N"
    >;

    caseFileChecklist: HashMap.HashMap<Card, "Y" | "N">;

    playerHandSize: HashMap.HashMap<Player, number>;

    suggestions: HashSet.HashSet<Suggestion>,
}>;

export const empty: Knowledge = Data.struct({
    playerChecklist: HashMap.empty(),
    caseFileChecklist: HashMap.empty(),
    playerHandSize: HashMap.empty(),
    suggestions: HashSet.empty(),
});

export const updatePlayerChecklist = (
    key: Data.Data<[Player, Card]>,
    value: "Y" | "N",
) => (
    knowledge: Knowledge,
): Either.Either<LogicalParadoxPlayerChecklistValueNY | LogicalParadoxPlayerChecklistValueYN, Knowledge> => pipe(
    Either.all({
        playerChecklist: modifyAtOrFail(knowledge.playerChecklist, key, Option.match({
            // There is no existing value
            onNone: () => Either.right(value),

            // There is an existing value. Let's make sure it's not conflicting
            onSome: (existingValue) => pipe(
                Match.value([existingValue, value]),

                // If the existing and updated values match, we can update it!
                Match.when(["Y", "Y"], ([, value]) => Either.right(value)),
                Match.when(["N", "N"], ([, value]) => Either.right(value)),

                // If they conflict, return an error
                Match.when(["Y", "N"], ([existingValue, value]) => Either.left(LogicalParadoxPlayerChecklistValueYN({
                    key,
                    existingValue,
                    conflictingUpdatedValue: value,
                }))),
                Match.when(["N", "Y"], ([existingValue, value]) => Either.left(LogicalParadoxPlayerChecklistValueNY({
                    key,
                    existingValue,
                    conflictingUpdatedValue: value,
                }))),

                Match.exhaustive,
            ),
        })),

        caseFileChecklist: Either.right(knowledge.caseFileChecklist),
        playerHandSize: Either.right(knowledge.playerHandSize),
        suggestions: Either.right(knowledge.suggestions),
    }),

    Either.map(Data.struct),
);

export const updateCaseFileChecklist = (
    key: Card,
    value: "Y" | "N",
) => (
    knowledge: Knowledge,
): Either.Either<LogicalParadoxCaseFileChecklistValueNY | LogicalParadoxCaseFileChecklistValueYN, Knowledge> => pipe(
    Either.all({
        playerChecklist: Either.right(knowledge.playerChecklist),

        caseFileChecklist: modifyAtOrFail(knowledge.caseFileChecklist, key, Option.match({
            // There is no existing value
            onNone: () => Either.right(value),

            // There is an existing value. Let's make sure it's not conflicting
            onSome: (existingValue) => pipe(
                Match.value([existingValue, value]),

                // If the existing and updated values match, we can update it!
                Match.when(["Y", "Y"], ([, value]) => Either.right(value)),
                Match.when(["N", "N"], ([, value]) => Either.right(value)),

                // If they conflict, return an error
                Match.when(["Y", "N"], ([existingValue, value]) => Either.left(LogicalParadoxCaseFileChecklistValueYN({
                    key,
                    existingValue,
                    conflictingUpdatedValue: value,
                }))),
                Match.when(["N", "Y"], ([existingValue, value]) => Either.left(LogicalParadoxCaseFileChecklistValueNY({
                    key,
                    existingValue,
                    conflictingUpdatedValue: value,
                }))),

                Match.exhaustive,
            ),
        })),

        playerHandSize: Either.right(knowledge.playerHandSize),
        suggestions: Either.right(knowledge.suggestions),
    }),

    Either.map(Data.struct),
);

export const updatePlayerHandSize = (
    key: Player,
    value: number,
) => (
    knowledge: Knowledge,
): Either.Either<
    | LogicalParadoxPlayerHandSizeValue
    | LogicalParadoxPlayerHandSizeNegative
    | LogicalParadoxPlayerHandSizeExceedsNumCards,
    Knowledge
> => pipe(
    Either.all({
        playerChecklist: Either.right(knowledge.playerChecklist),
        caseFileChecklist: Either.right(knowledge.caseFileChecklist),

        playerHandSize: pipe(
            knowledge.playerHandSize,

            modifyAtOrFail(key, Option.match({
                // There is no existing value
                onNone: () => Either.right(value),

                // There is an existing value. Let's make sure it's not conflicting
                onSome: (existingValue) =>
                    existingValue === value
                        ? Either.right(value)
                        : Either.left(LogicalParadoxPlayerHandSizeValue({
                            key,
                            existingValue,
                            conflictingUpdatedValue: value,
                        })),
            })),

            // Let's sanity check some basic constraints
            // TODO do this
        ),

        suggestions: Either.right(knowledge.suggestions),
    }),

    Either.map(Data.struct),
);

export const updateSuggestions = (
    suggestion: Suggestion,
) => (
    knowledge: Knowledge,
): Knowledge => pipe(
    knowledge,
    Struct.evolve({
        suggestions: HashSet.add(suggestion),
    }),
    Data.struct,
);

export type LogicalParadox =
    | LogicalParadoxPlayerChecklistValueYN
    | LogicalParadoxPlayerChecklistValueNY
    | LogicalParadoxCaseFileChecklistValueYN
    | LogicalParadoxCaseFileChecklistValueNY
    | LogicalParadoxPlayerHandSizeValue
    | LogicalParadoxPlayerHandSizeNegative
    | LogicalParadoxPlayerHandSizeExceedsNumCards;

interface LogicalParadoxConflictingValue<K, V, VEnumerable extends boolean, V1 extends V, V2 extends (VEnumerable extends true ? Exclude<V, V1> : V)> extends Data.Case {
    key: K;
    existingValue: V1;
    conflictingUpdatedValue: V2;
}

interface LogicalParadoxPlayerChecklistValueYN extends LogicalParadoxConflictingValue<Data.Data<[Player, Card]>, "Y" | "N", true, "Y", "N"> {
    _tag: "LogicalParadoxPlayerChecklistValueYN";
}

const LogicalParadoxPlayerChecklistValueYN = Data.tagged<LogicalParadoxPlayerChecklistValueYN>("LogicalParadoxPlayerChecklistValueYN");

interface LogicalParadoxPlayerChecklistValueNY extends LogicalParadoxConflictingValue<Data.Data<[Player, Card]>, "Y" | "N", true, "N", "Y"> {
    _tag: "LogicalParadoxPlayerChecklistValueNY";
}

const LogicalParadoxPlayerChecklistValueNY = Data.tagged<LogicalParadoxPlayerChecklistValueNY>("LogicalParadoxPlayerChecklistValueNY");

interface LogicalParadoxCaseFileChecklistValueYN extends LogicalParadoxConflictingValue<Card, "Y" | "N", true, "Y", "N"> {
    _tag: "LogicalParadoxCaseFileChecklistValueYN";
}

const LogicalParadoxCaseFileChecklistValueYN = Data.tagged<LogicalParadoxCaseFileChecklistValueYN>("LogicalParadoxCaseFileChecklistValueYN");

interface LogicalParadoxCaseFileChecklistValueNY extends LogicalParadoxConflictingValue<Card, "Y" | "N", true, "N", "Y"> {
    _tag: "LogicalParadoxCaseFileChecklistValueNY";
}

const LogicalParadoxCaseFileChecklistValueNY = Data.tagged<LogicalParadoxCaseFileChecklistValueNY>("LogicalParadoxCaseFileChecklistValueNY");

interface LogicalParadoxPlayerHandSizeValue extends LogicalParadoxConflictingValue<Player, number, false, number, number> {
    _tag: "LogicalParadoxPlayerHandSizeValue";
}

const LogicalParadoxPlayerHandSizeValue = Data.tagged<LogicalParadoxPlayerHandSizeValue>("LogicalParadoxPlayerHandSizeValue");

interface LogicalParadoxPlayerHandSizeNegative extends Data.Case {
    _tag: "LogicalParadoxPlayerHandSizeNegative";
}

interface LogicalParadoxPlayerHandSizeExceedsNumCards extends Data.Case {
    _tag: "LogicalParadoxPlayerHandSizeNegative";
}
