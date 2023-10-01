import { Data } from "effect";
import { Card, Player } from "./GameObjects";

export type LogicalParadox =
    | LogicalParadoxPlayerChecklistValueYN
    | LogicalParadoxPlayerChecklistValueNY
    | LogicalParadoxCaseFileChecklistValueYN
    | LogicalParadoxCaseFileChecklistValueNY
    | LogicalParadoxPlayerHandSizeValue
    | LogicalParadoxPlayerHandSizeNegative
    | LogicalParadoxPlayerHandSizeTooBig;

interface LogicalParadoxConflictingValue<K, V, VEnumerable extends boolean, V1 extends V, V2 extends (VEnumerable extends true ? Exclude<V, V1> : V)> extends Data.Case {
    key: K;
    existingValue: V1;
    conflictingUpdatedValue: V2;
}

interface LogicalParadoxPlayerChecklistValueYN extends LogicalParadoxConflictingValue<Data.Data<[Player, Card]>, "Y" | "N", true, "Y", "N"> {
    _tag: "LogicalParadoxPlayerChecklistValueYN";
}

export const LogicalParadoxPlayerChecklistValueYN = Data.tagged<LogicalParadoxPlayerChecklistValueYN>("LogicalParadoxPlayerChecklistValueYN");

interface LogicalParadoxPlayerChecklistValueNY extends LogicalParadoxConflictingValue<Data.Data<[Player, Card]>, "Y" | "N", true, "N", "Y"> {
    _tag: "LogicalParadoxPlayerChecklistValueNY";
}

export const LogicalParadoxPlayerChecklistValueNY = Data.tagged<LogicalParadoxPlayerChecklistValueNY>("LogicalParadoxPlayerChecklistValueNY");

interface LogicalParadoxCaseFileChecklistValueYN extends LogicalParadoxConflictingValue<Card, "Y" | "N", true, "Y", "N"> {
    _tag: "LogicalParadoxCaseFileChecklistValueYN";
}

export const LogicalParadoxCaseFileChecklistValueYN = Data.tagged<LogicalParadoxCaseFileChecklistValueYN>("LogicalParadoxCaseFileChecklistValueYN");

interface LogicalParadoxCaseFileChecklistValueNY extends LogicalParadoxConflictingValue<Card, "Y" | "N", true, "N", "Y"> {
    _tag: "LogicalParadoxCaseFileChecklistValueNY";
}

export const LogicalParadoxCaseFileChecklistValueNY = Data.tagged<LogicalParadoxCaseFileChecklistValueNY>("LogicalParadoxCaseFileChecklistValueNY");

interface LogicalParadoxPlayerHandSizeValue extends LogicalParadoxConflictingValue<Player, number, false, number, number> {
    _tag: "LogicalParadoxPlayerHandSizeValue";
}

export const LogicalParadoxPlayerHandSizeValue = Data.tagged<LogicalParadoxPlayerHandSizeValue>("LogicalParadoxPlayerHandSizeValue");

interface LogicalParadoxPlayerHandSizeNegative extends Data.Case {
    _tag: "LogicalParadoxPlayerHandSizeNegative";
    player: Player;
    negativeHandSize: number;
}

export const LogicalParadoxPlayerHandSizeNegative = Data.tagged<LogicalParadoxPlayerHandSizeNegative>("LogicalParadoxPlayerHandSizeNegative");

interface LogicalParadoxPlayerHandSizeTooBig extends Data.Case {
    _tag: "LogicalParadoxPlayerHandSizeTooBig";
    player: Player;
    tooBigHandSize: number;
}

export const LogicalParadoxPlayerHandSizeTooBig = Data.tagged<LogicalParadoxPlayerHandSizeTooBig>("LogicalParadoxPlayerHandSizeTooBig");
