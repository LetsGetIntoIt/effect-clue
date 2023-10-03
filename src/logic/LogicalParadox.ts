import { Data } from "effect";
import { Card, Player } from "./GameObjects";

export type LogicalParadox =
    | PlayerChecklistValueConflictYN
    | PlayerChecklistValueConflictNY
    | CaseFileChecklistValueConflictYN
    | CaseFileChecklistValueConflictNY
    | PlayerHandSizeValueConflict
    | PlayerHandSizeNegative
    | PlayerHandSizeTooBig
    | CardHasTooManyOwners
    | CardHasTooFewOwners
    | PlayerHasTooManyCards
    | PlayerHasTooFewCards
    | CaseFileHasTooManyCards
    | CaseFileHasTooFewCards;

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

interface CardHasTooManyOwners extends Data.Case {
    _tag: "CardHasTooManyOwners";
    card: Card;
    numOwners: number;
    expectedMaxNumOwners: number;
}

export const CardHasTooManyOwners = Data.tagged<CardHasTooManyOwners>("CardHasTooManyOwners");

interface CardHasTooFewOwners extends Data.Case {
    _tag: "CardHasTooFewOwners";
    card: Card;
    numNonOwners: number;
    expectedMinNumOwners: number;
}

export const CardHasTooFewOwners = Data.tagged<CardHasTooFewOwners>("CardHasTooFewOwners");

interface PlayerHasTooManyCards extends Data.Case {
    _tag: "PlayerHasTooManyCards";
    player: Player;
    numOwned: number;
    expectedMaxNumCards: number;
}

export const PlayerHasTooManyCards = Data.tagged<PlayerHasTooManyCards>("PlayerHasTooManyCards");

interface PlayerHasTooFewCards extends Data.Case {
    _tag: "PlayerHasTooFewCards";
    player: Player;
    numNotOwned: number;
    expectedMinNumCards: number;
}

export const PlayerHasTooFewCards = Data.tagged<PlayerHasTooFewCards>("PlayerHasTooFewCards");

interface CaseFileHasTooManyCards extends Data.Case {
    _tag: "CaseFileHasTooManyCards";
    numOwned: number;
    expectedMaxNumCards: number;
}

export const CaseFileHasTooManyCards = Data.tagged<CaseFileHasTooManyCards>("CaseFileHasTooManyCards");

interface CaseFileHasTooFewCards extends Data.Case {
    _tag: "CaseFileHasTooFewCards";
    numNotOwned: number;
    expectedMinNumCards: number;
}

export const CaseFileHasTooFewCards = Data.tagged<CaseFileHasTooFewCards>("CaseFileHasTooFewCards");
