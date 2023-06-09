import * as ROA from "@effect/data/ReadonlyArray";
import * as O from '@effect/data/Option';
import * as HM from "@effect/data/HashMap";
import * as T from '@effect/io/Effect';

import * as Player from "./Player";
import * as PlayerSetup from "./PlayerSetup";
import * as Card from './Card';
import * as CardSetup from './CardSetup';
import * as CardHolder from './CardHolder';
import * as Guess from './Guess';
import * as GuessHistory from './GuessHistory';

interface Reason {
    level: 'observed' | 'inferred' | 'suspected';
    description: string;
}

interface OwnershipConclusionKey {
    holder: CardHolder.CardHolder;
    card: Card.Card;
}

interface OnwershipConclusionValue {
    has: boolean;
}

interface RefutationConclusionKey {
    guess: Guess.Guess; // TODO replace with an ID?
}

interface RefutationConclusionValue {
    card: Card.Card;
}

interface Conclusions {
    ownership: HM.HashMap<OwnershipConclusionKey, [OnwershipConclusionValue, Reason]>;
    refutations: HM.HashMap<RefutationConclusionKey, [RefutationConclusionValue, Reason]>;
}

type Deduction = (conclusions: Conclusions) => T.Effect<CardSetup.CardSetup | PlayerSetup.PlayerSetup | GuessHistory.GuessHistory, never, Conclusions>;

const cardOwnedExactlyOnce: Deduction = (conclusions) => T.gen(function* ($) {
    // - Each row must have exactly 1 "yes"
    // -    "__ has the card, so nobody else can"
    // -    "Nobody else has the card, so ___ must have it"
});

const caseFileOwnsExactlyOneOfEachType: Deduction = (conclusions) => T.gen(function* ($) {
    // - The Case File must has exacxtly 1 "yes" of each card type
    // -    "The Case File has ___, so it cannot also have ___"
    // -    "The Case File has no other ____s, so it must be ___"
});

const eachPlayerOwnsExactly: Deduction = (conclusions) => T.gen(function* ($) {
    // - Each player must have exactly so many cards
    // -    "All of ___'s card are accounted for, so they cannot have this"
    // -    "All of ___'s cards have been rules out, so they must have this" 
});


const nonRefuterDoesNotOwn: Deduction = (conclusions) => T.gen(function* ($) {
    // - Any player that skips refutation does not have those cards
    // -    "___ could not refute guess ___, so they cannot have this"
});

const refuterUsesOwnedCard: Deduction = (conclusions) => T.gen(function* ($) {
    // - Any player that refutes a guess, did so with a card we know they have
    // -    "___ has ___, so they could have refuted guess ____ with it"
});

const refuterHasOneOf: Deduction = (conclusions) => T.gen(function* ($) {
    // - Any player that refutes a guess, must have one of those cards
    // -    "___ refuted guess ____, so they must have one of ___, ___, ___"
});
