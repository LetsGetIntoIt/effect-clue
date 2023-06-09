import * as ROA from "@effect/data/ReadonlyArray";
import * as HM from "@effect/data/HashMap";

import * as CardHolder from './CardHolder';
import * as Player from "./Player";
import * as Card from './Card';
import * as Guess from './Guess';

interface Reason {
    level: 'observed' | 'inferred' | 'suspected';
    description: string;
}

interface OwnershipDeductionKey {
    holder: CardHolder.CardHolder;
    card: Card.Card;
}

interface OnwershipDeductionValue {
    has: boolean;
}

interface RefutationDeductionKey {
    guess: Guess.Guess; // TODO replace with an ID?
}

interface RefutationDeductionValue {
    card: Card.Card;
}

interface GameDeductions<CardType extends string, CardLabel extends string, PlayerLabel extends string> {
    ownership: HM.HashMap<OwnershipDeductionKey, [OnwershipDeductionValue, Reason]>;
    refutations: HM.HashMap<RefutationDeductionKey, [RefutationDeductionValue, Reason]>;
}

// Deduction rules
// - Each row must have exactly 1 "yes"
// -    "__ has the card, so nobody else can"
// -    "Nobody else has the card, so ___ must have it"
// - The Case File must has exacxtly 1 "yes" of each card type
// -    "The Case File has ___, so it cannot also have ___"
// -    "The Case File has no other ____s, so it must be ___"
// - Each player must have exactly so many cards
// -    "All of ___'s card are accounted for, so they cannot have this"
// -    "All of ___'s cards have been rules out, so they must have this"
// - Any player that skips refutation does not have those cards
// -    "___ could not refute guess ___, so they cannot have this"
// - Any player that refutes a guess, did so with a card we know they have
// -    "___ has ___, so they could have refuted guess ____ with it"
// - Any player that refutes a guess, must have one of those cards
// -    "___ refuted guess ____, so they must have one of ___, ___, ___"
