import * as E from '@effect/data/Either';
import * as SG from '@effect/data/typeclass/Semigroup';
import * as MON from '@effect/data/typeclass/Monoid';
import { constUndefined, constant, flow, pipe } from '@effect/data/Function';
import * as HS from '@effect/data/HashSet';
import * as HM from '@effect/data/HashMap';
import * as T from '@effect/io/Effect';
import * as EQ from '@effect/data/Equal';
import * as P from '@effect/data/Predicate';
import * as ROA from '@effect/data/ReadonlyArray';
import * as O from '@effect/data/Option';

import { Effect_getSemigroupCombine, HashMap_someWithIndex } from '../utils/ShouldBeBuiltin';

import * as Game from "./Game";
import * as ConclusionMapSet from "./ConclusionMapSet";
import * as CardOwner from './CardOwner';

export type DeductionRule = T.Effect<
    // Accepts the objects in the game
    | Game.Game

    // Accepts a set of "known" conclusions
    | ConclusionMapSet.ConclusionMapSet
,
    // Returns an error if we encounter a logical contradiction
    string
,
    // Returns the newly-deduced conclusion (not included the already known ones)
    ConclusionMapSet.ConclusionMapSet
>;

export const constEmpty: DeductionRule =
    T.succeed(ConclusionMapSet.empty);

export const SemigroupUnion: SG.Semigroup<DeductionRule> = 
    Effect_getSemigroupCombine<
        ConclusionMapSet.ConclusionMapSet,
        string,
        Game.Game | ConclusionMapSet.ConclusionMapSet
    >(
        (first: ConclusionMapSet.ConclusionMapSet, second) => pipe(
            first,
            ConclusionMapSet.combine(second),
        ),
    );

export const MonoidUnion: MON.Monoid<DeductionRule> = MON.fromSemigroup(
    SemigroupUnion,
    constEmpty,
);

// If a card is held by an owner, it cannot be held by anyone else
export const cardIsHeldAtMostOnce: DeductionRule = T.gen(function* ($) {
    const game = yield* $(Game.Tag);

    const knownConclusions = yield* $(ConclusionMapSet.Tag);

    // Get a map of known owned and unowned cards
    const ownedCards = ConclusionMapSet.getOwnedCards(knownConclusions);
    const unownedCards = ConclusionMapSet.getUnownedCards(knownConclusions);

    // For each owned card, find those whose ownership is unknown
    const unknownOwnersOfOwnedCards = HM.mapWithIndex(ownedCards, (owner, card) => {
        // Figure out who definitely does not own this card
        const nonOwners = pipe(
            HM.get(unownedCards, card),
            O.getOrElse(HS.empty<CardOwner.CardOwner>),
        );

        // Subtract the full list of cardowners
        // TODO need to be able to get all the card owners in a game
    });
});

// If a card is held by everyone except one, then it's held by that one
export const cardIsHeldAtLeastOnce: DeductionRule = null;

export const cardIsHeldExactlyOnce: DeductionRule =
    SemigroupUnion.combine(cardIsHeldAtMostOnce, cardIsHeldAtLeastOnce);

// If all of a player's cards are accounted for, they don't have any others
export const playerHasAtMostNumCards: DeductionRule = null;

// If all of a player's missing cards are accounted for (the number that will be missing), they have all the others
export const playerHasAtLeastNumCards: DeductionRule = null;

export const playerHasExactlyNumCards: DeductionRule =
    SemigroupUnion.combine(playerHasAtMostNumCards, playerHasAtLeastNumCards);

// If indentify a card in the case file, it's none of the other ones of that type
export const caseFileHasAtMostOnePerCardType: DeductionRule = null;

// If we eliminate all but 1 of a card of a type, then it's the remaining one
export const caseFileHasAtLeastOnePerCardType: DeductionRule = null;

export const caseFileHasExactlyOnePerCardType: DeductionRule =
    SemigroupUnion.combine(caseFileHasAtMostOnePerCardType, caseFileHasAtLeastOnePerCardType);

// If someone has refuted a guess, then list the following assumed refute cards:
// - {player's known owned cards} & {guessed cards} ==> "(owned)"
// - {player's unknown ownerships} & {guess cards} ==> "(maybe)"
export const guessIsRefutedByHeldCard: DeductionRule = null;
