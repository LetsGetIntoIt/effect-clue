import { Data } from "effect";
import { Card, Player } from "./GameObjects";

export type LogicalParadox =
    | PlayerChecklistValueConflictYN
    | PlayerChecklistValueConflictNY
    | CaseFileChecklistValueConflictYN
    | CaseFileChecklistValueConflictNY
    | PlayerHandSizeValueConflict
    | PlayerHandSizeNegative
    | PlayerHandSizeTooBig;

interface LogicalParadoxConflictingValue<K, V, VEnumerable extends boolean, V1 extends V, V2 extends (VEnumerable extends true ? Exclude<V, V1> : V)> extends Data.Case {
    key: K;
    existingValue: V1;
    conflictingUpdatedValue: V2;
}

interface PlayerChecklistValueConflictYN extends LogicalParadoxConflictingValue<Data.Data<[Player, Card]>, "Y" | "N", true, "Y", "N"> {
    _tag: "PlayerChecklistValueConflictYN";
}

export const PlayerChecklistValueConflictYN = Data.tagged<PlayerChecklistValueConflictYN>("PlayerChecklistValueConflictYN");

interface PlayerChecklistValueConflictNY extends LogicalParadoxConflictingValue<Data.Data<[Player, Card]>, "Y" | "N", true, "N", "Y"> {
    _tag: "PlayerChecklistValueConflictNY";
}

export const PlayerChecklistValueConflictNY = Data.tagged<PlayerChecklistValueConflictNY>("PlayerChecklistValueConflictNY");

interface CaseFileChecklistValueConflictYN extends LogicalParadoxConflictingValue<Card, "Y" | "N", true, "Y", "N"> {
    _tag: "CaseFileChecklistValueConflictYN";
}

export const CaseFileChecklistValueConflictYN = Data.tagged<CaseFileChecklistValueConflictYN>("CaseFileChecklistValueConflictYN");

interface CaseFileChecklistValueConflictNY extends LogicalParadoxConflictingValue<Card, "Y" | "N", true, "N", "Y"> {
    _tag: "CaseFileChecklistValueConflictNY";
}

export const CaseFileChecklistValueConflictNY = Data.tagged<CaseFileChecklistValueConflictNY>("CaseFileChecklistValueConflictNY");

interface PlayerHandSizeValueConflict extends LogicalParadoxConflictingValue<Player, number, false, number, number> {
    _tag: "PlayerHandSizeValueConflict";
}

export const PlayerHandSizeValueConflict = Data.tagged<PlayerHandSizeValueConflict>("PlayerHandSizeValueConflict");

interface PlayerHandSizeNegative extends Data.Case {
    _tag: "PlayerHandSizeNegative";
    player: Player;
    negativeHandSize: number;
}

export const PlayerHandSizeNegative = Data.tagged<PlayerHandSizeNegative>("PlayerHandSizeNegative");

interface PlayerHandSizeTooBig extends Data.Case {
    _tag: "PlayerHandSizeTooBig";
    player: Player;
    tooBigHandSize: number;
}

export const PlayerHandSizeTooBig = Data.tagged<PlayerHandSizeTooBig>("PlayerHandSizeTooBig");
