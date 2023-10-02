import { Data, Either, Equal, Hash, HashMap, HashSet, Match, Option, pipe } from "effect";
import { Card, Player } from "./GameObjects";
import { modifyAtOrFail } from "./utils/Effect";
import { LogicalParadox, LogicalParadoxCaseFileChecklistValueNY, LogicalParadoxCaseFileChecklistValueYN, LogicalParadoxPlayerChecklistValueNY, LogicalParadoxPlayerChecklistValueYN, LogicalParadoxPlayerHandSizeValue } from "./LogicalParadox";

export const ChecklistValue = (value: "Y" | "N"): "Y" | "N" => value;

export class Knowledge extends Data.Class<{
    playerChecklist: HashMap.HashMap<
        Data.Data<[Player, Card]>,
        "Y" | "N"
    >;

    caseFileChecklist: HashMap.HashMap<Card, "Y" | "N">;

    playerHandSize: HashMap.HashMap<Player, number>;
}> {
    private static playerChecklistItemFingerprint([player, card]: Data.Data<[Player, Card]>, value: "Y" | "N") {
        return `PC-${player}-${card}-${value}`;
    }

    private static caseFileChecklistItemFingerprint(card: Card, value: "Y" | "N") {
        return `CFC-${card}-${value}`;
    }

    private static playerHandSizeItemFingerprint(player: Player, value: number) {
        return `PHS-${player}-${value}`;
    }

    private _fingerprint: Option.Option<HashSet.HashSet<string>> = Option.none();
    private get fingerprint(): HashSet.HashSet<string> {
        return Option.getOrElse(
            this._fingerprint,
            () => {
                const fingerprint = HashSet.make(
                    ...[...this.playerChecklist].map(([key, value]) =>
                        Knowledge.playerChecklistItemFingerprint(key, value),
                    ),

                    ...[...this.caseFileChecklist].map(([key, value]) =>
                        Knowledge.caseFileChecklistItemFingerprint(key, value),
                    ),

                    ...[...this.playerHandSize].map(([key, numCards]) =>
                        Knowledge.playerHandSizeItemFingerprint(key, numCards),
                    ),
                );

                this._fingerprint = Option.some(fingerprint);
                return fingerprint;
            },
        );
    }

    [Hash.symbol](): number {
        return Hash.hash(this.fingerprint);
    }

    [Equal.symbol](other: Equal.Equal): boolean {
        if (!(other instanceof Knowledge)) {
            return false;
        }

       return Equal.equals(this.fingerprint, other.fingerprint);
    }

    updatePlayerChecklist(
        key: Data.Data<[Player, Card]>,
        value: "Y" | "N",
    ): Either.Either<LogicalParadox, Knowledge> {
        return pipe(
            Either.all({
                playerChecklist: modifyAtOrFail(this.playerChecklist, key, Option.match({
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
        
                caseFileChecklist: Either.right(this.caseFileChecklist),
                playerHandSize: Either.right(this.playerHandSize),
            }),

            Either.map(props => {
                const newKnowledge = new Knowledge(props);
                newKnowledge._fingerprint = Option.some(HashSet.add(this.fingerprint, Knowledge.playerChecklistItemFingerprint(key, value)));
                return newKnowledge;
            }),
        );
    }

    updateCaseFileChecklist(
        key: Card,
        value: "Y" | "N",
    ): Either.Either<LogicalParadox, Knowledge> {
        return pipe(
            Either.all({
                playerChecklist: Either.right(this.playerChecklist),

                caseFileChecklist: modifyAtOrFail(this.caseFileChecklist, key, Option.match({
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
        
                playerHandSize: Either.right(this.playerHandSize),
            }),

            Either.map(props => {
                const newKnowledge = new Knowledge(props);
                newKnowledge._fingerprint = Option.some(HashSet.add(this.fingerprint, Knowledge.caseFileChecklistItemFingerprint(key, value)));
                return newKnowledge;
            }),
        );
    }

    updatePlayerHandSize (
        key: Player,
        value: number,
    ): Either.Either<LogicalParadox, Knowledge> {
        return pipe(
            Either.all({
                playerChecklist: Either.right(this.playerChecklist),
                caseFileChecklist: Either.right(this.caseFileChecklist),

                playerHandSize: pipe(
                    this.playerHandSize,

                    modifyAtOrFail(key, Option.match({
                        // There is no existing value
                        onNone: () => Either.right(value),

                        // There is an existing value. Let's make sure it's not conflicting
                        onSome: (existingValue) => existingValue === value
                            ? Either.right(value)
                            : Either.left(LogicalParadoxPlayerHandSizeValue({
                                key,
                                existingValue,
                                conflictingUpdatedValue: value,
                            })),
                    }))

                ),
            }),

            Either.map(props => {
                const newKnowledge = new Knowledge(props);
                newKnowledge._fingerprint = Option.some(HashSet.add(this.fingerprint, Knowledge.playerHandSizeItemFingerprint(key, value)));
                return newKnowledge;
            }),
        );
    }
}

export const emptyKnowledge: Knowledge = new Knowledge({
    playerChecklist: HashMap.empty(),
    caseFileChecklist: HashMap.empty(),
    playerHandSize: HashMap.empty(),
});

export const updatePlayerChecklist = (
    key: Data.Data<[Player, Card]>,
    value: "Y" | "N",
) => (
    knowledge: Knowledge,
): Either.Either<LogicalParadox, Knowledge> =>
    knowledge.updatePlayerChecklist(key, value);

export const updateCaseFileChecklist = (
    key: Card,
    value: "Y" | "N",
) => (
    knowledge: Knowledge,
): Either.Either<LogicalParadox, Knowledge> =>
    knowledge.updateCaseFileChecklist(key, value);

export const updatePlayerHandSize = (
    key: Player,
    value: number,
) => (
    knowledge: Knowledge,
): Either.Either<LogicalParadox, Knowledge> =>
    knowledge.updatePlayerHandSize(key, value);
