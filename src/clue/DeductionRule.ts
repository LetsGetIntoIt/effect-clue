import * as E from '@effect/data/Either';
import * as SG from '@effect/data/typeclass/Semigroup';
import * as MON from '@effect/data/typeclass/Monoid';
import * as HS from '@effect/data/HashSet';
import * as HM from '@effect/data/HashMap';
import * as T from '@effect/io/Effect';
import * as ROA from '@effect/data/ReadonlyArray';
import { flow, pipe } from '@effect/data/Function';

import { Effect_getSemigroupCombine, HashMap_fromHashSetMap, HashSet_fromHashMapMulti, HashSet_fromOption, HashSet_isSize } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as Game from "./Game";
import * as ConclusionMapSet from "./ConclusionMapSet";
import * as CardOwner from './CardOwner';
import * as CardOwnership from './CardOwnership';
import * as CardOwnerCardPair from './CardOwnerCardPair';
import * as Conclusion from './Conclusion';

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
            ConclusionMapSet.modifyCombine(second),
        ),
    );

export const MonoidUnion: MON.Monoid<DeductionRule> = MON.fromSemigroup(
    SemigroupUnion,
    constEmpty,
);

// If a card is held by an owner, it cannot be held by anyone else
export const cardIsHeldAtMostOnce: DeductionRule = T.gen(function* ($) {
    const game = yield* $(Game.Tag);
    const allCards = Game.getCards(game);
    const allCardOwners = Game.getCardOwners(game);

    const knownConclusions = yield* $(ConclusionMapSet.Tag);
    const getOwnershipOf = ConclusionMapSet.getOwnershipOf(knownConclusions);

    // For each card that is owned, mark it as NOT owned by any owner left blank
    const modifyConclusions = yield* $(
        allCards,

        // Get ownership info of every card in the game
        HashMap_fromHashSetMap(getOwnershipOf),

        // Keep only the cards with a known owner
        HM.filter(CardOwnership.isCardOwnershipOwned),

        // Figure out the owners we DON'T know about
        HM.map(flow(
            // Put together a set of all the owners we know about
            ({ owner, nonOwners }) => HS.add(nonOwners, owner),

            // Find the difference from all owners in the game
            // This is the owners that are blank for this card
            known => HS.difference(allCardOwners, known),
        )),

        // Convert to a nice set of pairs
        HashSet_fromHashMapMulti,

        // Now put together all the modifications we need to apply
        HS.map(([card, owner]) =>
            E.gen(function* ($) {
                const cardOwnerCardPair = yield* $(CardOwnerCardPair.create({
                    owner,
                    card,
                }));

                // TODO make reasons structured/an enum
                const reason = Conclusion.createReason({
                    level: 'inferred',
                    explanation: `Card is already owned by someone else`
                });

                return ConclusionMapSet.modifyAddOwnership(cardOwnerCardPair, false, reason);
            })
        ),

        HS.values,
        ROA.fromIterable,
        ROA.sequence(E.Applicative),

        // Convert them into a single modification
        E.map(ConclusionMapSet.ModificationMonoid.combineAll),
    );

    return yield* $(modifyConclusions(knownConclusions));
});

// TODO reduce duplication with the other card holding rule
// If a card is held by everyone except one, then it's held by that one
export const cardIsHeldAtLeastOnce: DeductionRule = T.gen(function* ($) {
    const game = yield* $(Game.Tag);
    const allCards = Game.getCards(game);
    const allCardOwners = Game.getCardOwners(game);

    const knownConclusions = yield* $(ConclusionMapSet.Tag);
    const getOwnershipOf = ConclusionMapSet.getOwnershipOf(knownConclusions);

    // For each card that is not owned, if there is a single unknown, mark it as OWNED
    const modifyConclusions = yield* $(
        allCards,

        // Get ownership info of every card in the game
        HashMap_fromHashSetMap(getOwnershipOf),

        // Keep only the cards with a known owner
        HM.filter(CardOwnership.isCardOwnershipUnowned),

        // Figure out the owners we DON'T know about
        HM.map(({ nonOwners }) => HS.difference(allCardOwners, nonOwners)),

        // Keep only the cards that have exactly 1 unknown owner
        HM.filter(HashSet_isSize(1)),

        // Convert to a nice set of pairs
        HashSet_fromHashMapMulti,

        // Now put together all the modifications we need to apply
        HS.map(([card, owner]) =>
            E.gen(function* ($) {
                const cardOwnerCardPair = yield* $(CardOwnerCardPair.create({
                    owner,
                    card,
                }));

                // TODO make reasons structured/an enum
                const reason = Conclusion.createReason({
                    level: 'inferred',
                    explanation: `Card not owned anywhere else`,
                });

                return ConclusionMapSet.modifyAddOwnership(cardOwnerCardPair, true, reason);
            })
        ),

        HS.values,
        ROA.fromIterable,
        ROA.sequence(E.Applicative),

        // Convert them into a single modification
        E.map(ConclusionMapSet.ModificationMonoid.combineAll),
    );

    return yield* $(modifyConclusions(knownConclusions));
});

export const cardIsHeldExactlyOnce: DeductionRule =
    SemigroupUnion.combine(cardIsHeldAtMostOnce, cardIsHeldAtLeastOnce);

// If all of a player's cards are accounted for, they don't have any others
export const playerHasAtMostNumCards: DeductionRule =
    T.fail(`DeductionRule playerHasAtMostNumCards not implemented yet`);

// If all of a player's missing cards are accounted for (the number that will be missing), they have all the others
export const playerHasAtLeastNumCards: DeductionRule =
    T.fail(`DeductionRule playerHasAtLeastNumCards not implemented yet`);

export const playerHasExactlyNumCards: DeductionRule =
    SemigroupUnion.combine(playerHasAtMostNumCards, playerHasAtLeastNumCards);

// If indentify a card in the case file, it's none of the other ones of that type
export const caseFileHasAtMostOnePerCardType: DeductionRule =
    T.fail(`DeductionRule caseFileHasAtMostOnePerCardType not implemented yet`);

// If we eliminate all but 1 of a card of a type, then it's the remaining one
export const caseFileHasAtLeastOnePerCardType: DeductionRule =
    T.fail(`DeductionRule caseFileHasAtLeastOnePerCardType not implemented yet`);

export const caseFileHasExactlyOnePerCardType: DeductionRule =
    SemigroupUnion.combine(caseFileHasAtMostOnePerCardType, caseFileHasAtLeastOnePerCardType);

// If someone has refuted a guess, then list the following assumed refute cards:
// - {player's known owned cards} & {guessed cards} ==> "(owned)"
// - {player's unknown ownerships} & {guess cards} ==> "(maybe)"
export const guessIsRefutedByHeldCard: DeductionRule =
    T.fail(`DeductionRule guessIsRefutedByHeldCard not implemented yet`);
