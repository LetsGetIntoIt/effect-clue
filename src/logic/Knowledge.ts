import { Data, Either, HashMap, Match, Option, pipe } from "effect";
import { Card, Player } from "./GameObjects";
import { modifyAtOrFail } from "./utils/Effect";
import { LogicalParadox, LogicalParadoxCaseFileChecklistValueNY, LogicalParadoxCaseFileChecklistValueYN, LogicalParadoxPlayerChecklistValueNY, LogicalParadoxPlayerChecklistValueYN, LogicalParadoxPlayerHandSizeValue } from "./LogicalParadox";

export const ChecklistValue = (value: "Y" | "N"): "Y" | "N" => value;

export type Knowledge = Data.Data<{
    playerChecklist: HashMap.HashMap<
        Data.Data<[Player, Card]>,
        "Y" | "N"
    >;

    caseFileChecklist: HashMap.HashMap<Card, "Y" | "N">;

    playerHandSize: HashMap.HashMap<Player, number>;
}>;

export const emptyKnowledge: Knowledge = Data.struct({
    playerChecklist: HashMap.empty(),
    caseFileChecklist: HashMap.empty(),
    playerHandSize: HashMap.empty(),
});

export const updatePlayerChecklist = (
    key: Data.Data<[Player, Card]>,
    value: "Y" | "N",
) => (
    knowledge: Knowledge,
): Either.Either<LogicalParadox, Knowledge> => pipe(
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
    }),

    Either.map(Data.struct),
);

export const updateCaseFileChecklist = (
    key: Card,
    value: "Y" | "N",
) => (
    knowledge: Knowledge,
): Either.Either<LogicalParadox, Knowledge> => pipe(
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
    }),

    Either.map(Data.struct),
);

export const updatePlayerHandSize = (
    key: Player,
    value: number,
) => (
    knowledge: Knowledge,
): Either.Either<LogicalParadox, Knowledge> => pipe(
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
    }),

    Either.map(Data.struct),
);
