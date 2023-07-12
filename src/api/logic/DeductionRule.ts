import { T, SG, MON, HM, HS, ROA, N, P, EQ, O, BOOL, B } from '../utils/effect/EffectImports';
import { constant, pipe, identity as F_identity, constFalse, compose } from '@effect/data/Function';
import { Effect_getSemigroupCombine, Function_getSemigroup, HashMap_filterWithIndexKV, HashSet_differenceFrom, HashSet_fromHashMapMulti, HashSet_isEmpty as HashSet_isEmpty, HashSet_isSize, Option_fromPredicate, Refinement_identity, Struct_get } from '../utils/effect/Effect';

import { Game, CardOwner } from '../game';

import * as DeductionSet from "./DeductionSet";
import * as OwnershipOfCard from './utils/OwnershipOfCard';
import * as Conclusion from './utils/Conclusion';
import * as Range from './utils/Range';

type DeductionError = string;

export type DeductionRule = (
    // Accepts a set of "known" deductions
    knownDeductions: DeductionSet.ValidatedDeductionSet
) => T.Effect<
    // Accepts the game state
    Game.Game
,

    // Returns an error if we encounter a logical contradiction
    DeductionError | B.Brand.BrandErrors
,
    // Returns the set of deductions, augmented with new findings
    DeductionSet.ValidatedDeductionSet
>;

export const identity: DeductionRule =
    T.succeed;

export const SemigroupUnion: SG.Semigroup<DeductionRule> = 
    Function_getSemigroup(
        Effect_getSemigroupCombine<
            DeductionSet.ValidatedDeductionSet,
            DeductionError | B.Brand.BrandErrors,
            Game.Game
        >(
            (first, second) => pipe(
                first,
                DeductionSet.modifyCombine(second),
            ),
        ),
    )();

export const MonoidUnion: MON.Monoid<DeductionRule> = MON.fromSemigroup(
    SemigroupUnion,
    identity,
);

// TODO define this here or somewhere else?
export const ALL_DEDUCTION_RULES = [
    'playerHasAtLeastZeroCards',
    'playerHasMaxNumCardsRemaining',
    'playerHasNarrowestNumCardRange',
    'playerHasMinNumCardsRefuted',
    'cardIsHeldAtMostOnce',
    'cardIsHeldAtLeastOnce',
    'playerHasNoMoreThanMaxNumCards',
    'playerHasNoLessThanMinNumCards',
    'caseFileHasAtMostOnePerCardType',
    'caseFileHasAtLeastOnePerCardType',
    'guessIsRefutedByHeldCard',
    'playerWith1CardRefutesWithIntersection',
] as const;

// TODO define this here or somewhere else?
export type RawDeductionRule = typeof ALL_DEDUCTION_RULES[number];

// Every player has >=0 cards, and <= ALL_CARDS.size(), of course!
export const playerHasZeroToNumAllCards: DeductionRule = (
    knownDeductions
) => T.gen(function* ($) {
    const game = yield* $(Game.Tag);
    const numCards = HS.size(game.cards);

    // TODO update our knowledge about each player's number of cards. Camp to [0, numCards]
    return yield* $(T.fail(
        `DeductionRule playerHasZeroToNumAllCards not implemented yet`,
    ));
});

// A player can have at most TOTAL_NUM_CARDS - SUM(OTHER_PLAYER.MIN_NUM_CARDS)
export const playerHasMaxNumCardsRemaining: DeductionRule = (
    knownDeductions,
) => T.gen(function* ($) {
    const game = yield* $(Game.Tag);

    // Get the total number of cards in the game
    const totalNumCards = HS.size(game.cards);

    // How many are in the case file?
    // TODO this logic will need to update if case files can have more of any type of card
    const caseFileNumCards = HS.size(game.cardTypes);

    // How many cards do all players have at a minimum?
    const totalMinPlayerNumCards = pipe(
        knownDeductions.numCards,
        HM.map(compose(Struct_get('answer'), Range.getMin)),
        HM.values,
        N.sumAll,
    );

    // What is the maximum number of cards any player has?
    const maxNumCards = totalNumCards - caseFileNumCards - totalMinPlayerNumCards;

    // TODO update our knowledge about each player's number of cards
    return yield* $(T.fail(
        `DeductionRule playerHasMaxNumCardsRemaining not implemented yet`,
    ));
});

// A player's numCard range should update as we learn more about the cards they actually own/don't own
export const playerHasNarrowestNumCardRange: DeductionRule = (
    knownDeductions,
) => T.gen(function* ($) {
    return yield* $(T.fail(
        `DeductionRule playerHasNarrowestNumCardRange not implemented yet`,
    ));
});

// A player must have at least as many cards as required to make all their refutations
export const playerHasMinNumCardsRefuted: DeductionRule = (
    knownDeductions,
) => T.gen(function* ($) {
        // Filter down to all the guesses they have refuted, where we DON'T know which card they refuted with
        // Initialize MIN_NUM_CARDS=0 OR_CARDS={}
        // For each guess:
        //      If this has any overlap with existing OR_CARDS, ignore it and move on
        //      Else
        //          MIN_NUM_CARDS++
        //          OR_CARDS union= guessed cards
        // If the new minimum exceeds the max, is that a problem?

        return yield* $(T.fail(
            `DeductionRule playerHasMinNumCardsRefuted not implemented yet`,
        ));
    });

// If a card is held by an owner, it cannot be held by anyone else
export const cardIsHeldAtMostOnce: DeductionRule = (
    knownDeductions,
) => T.gen(function* ($) {
    const game = yield* $(Game.Tag);

    const ownershipByCard = DeductionSet.getOwnershipByCard(knownDeductions);

    // For each card that is owned, mark it as NOT owned by any owner left blank
    const modifyDeductions = pipe(
        ownershipByCard,

        // Keep only the cards with a known owner
        HM.filter(OwnershipOfCard.isOwned),

        // Figure out the owners we DON'T know about
        HM.map(compose(
            // Put together a set of all the owners we know about
            ({ owner, nonOwners }) => HS.add(nonOwners, owner),

            // Find the difference from all owners in the game
            // This is the owners that are blank for this card
            HashSet_differenceFrom(game.owners),
        )),

        // Convert to a nice set of pairs
        HashSet_fromHashMapMulti,

        // Now put together all the modifications we need to apply
        HS.map(([card, owner]) =>
            DeductionSet.modifyAddOwnership(
                owner,
                card,

                false,

                Conclusion.Reason({
                    level: 'inferred',
                    explanation: `Card is already owned by someone else`
                }),
            ),
        ),

        HS.values,
        ROA.fromIterable,

        // Convert them into a single modification
        DeductionSet.ModificationMonoid.combineAll,
    );

    return yield* $(modifyDeductions(knownDeductions));
});

// TODO reduce duplication with the other card holding rule
// If a card is held by everyone except one, then it's held by that one
export const cardIsHeldAtLeastOnce: DeductionRule = (
    knownDeductions,
) => T.gen(function* ($) {
    const game = yield* $(Game.Tag);

    const ownershipByCard = DeductionSet.getOwnershipByCard(knownDeductions);

    // For each card that is not owned, if there is a single unknown, mark it as OWNED
    const modifyDeductions = pipe(
        ownershipByCard,

        // Keep only the cards with a known owner
        HM.filter(OwnershipOfCard.isUnowned),

        // Figure out the owners we DON'T know about
        HM.map(compose(
            Struct_get('nonOwners'),
            HashSet_differenceFrom(game.owners),
        )),

        // Keep only the cards that have exactly 1 unknown owner
        HM.filter(HashSet_isSize(1)),

        // Now put together all the modifications we need to apply
        HashSet_fromHashMapMulti,
        HS.map(([card, owner]) =>
            DeductionSet.modifyAddOwnership(
                owner,
                card,

                true,
                
                Conclusion.Reason({
                    level: 'inferred',
                    explanation: `Card not owned anywhere else`,
                }),
            ),
        ),

        HS.values,
        ROA.fromIterable,

        // Convert them into a single modification
        DeductionSet.ModificationMonoid.combineAll,
    );

    return yield* $(modifyDeductions(knownDeductions));
});

// If all of a player's cards are accounted for, they don't have any others
export const playerHasNoMoreThanMaxNumCards: DeductionRule = (
    knownDeductions,
) => T.gen(function* ($) {
    const game = yield* $(Game.Tag);

    const modifyDeductions = pipe(
        DeductionSet.getOwnershipByOwner(knownDeductions),

        // We only care about players
        HashMap_filterWithIndexKV(
            CardOwner.isPlayer,
            Refinement_identity(),
        ),

        // We only care about players where we know their maxNum cards
        HM.filterWithIndex((ownership, owner) => {
            const numOwnedCards = pipe(
                ownership,
                HM.filter(F_identity),
                HM.size,
            );

            const maxNumOwnedCards = pipe(
                knownDeductions.numCards,
                HM.get(owner.player),
                O.map(compose(
                    Struct_get('answer'),
                    Range.getMax,
                )),
            );

            return O.match(maxNumOwnedCards, {
                // We don't know their max number of cards
                onNone: constFalse,

                // We do know their max num cards, and we know what all those cards are
                onTrue: EQ.equals(numOwnedCards),
            });
        }),

        // For these players, figure out which cards we DON'T know their ownership
        HM.map(compose(
            HM.keySet,
            HashSet_differenceFrom(game.cards),
        )),

        // Mark all these cards as UNOWNED by this player
        HashSet_fromHashMapMulti,
        HS.map(([owner, card]) =>
            DeductionSet.modifyAddOwnership(
                owner,
                card,

                false,

                Conclusion.Reason({
                    level: 'inferred',
                    explanation: `All of this player's cards have been accounted for already, so they cannot own this one`,
                }),
            ),
        ),

        HS.values,
        ROA.fromIterable,

        // Convert them into a single modification
        DeductionSet.ModificationMonoid.combineAll,
    );

    return yield* $(modifyDeductions(knownDeductions));
});

// For each player, if all cards are accounted for except their min number, then they own the rest
export const playerHasNoLessThanMinNumCards: DeductionRule = (
    knownDeductions,
) => T.gen(function* ($) {
    const game = yield* $(Game.Tag);

    const modifyDeductions = pipe(
        DeductionSet.getOwnershipByOwner(knownDeductions),

        // We only care about players
        HashMap_filterWithIndexKV(
            CardOwner.isPlayer,
            Refinement_identity(),
        ),

        // We only care about players where we know all cards except their min number of cards
        HM.filterWithIndex((ownership, owner) => {
            const numUnownedCards = pipe(
                ownership,
                HM.filter(BOOL.not),
                HM.size,
            );

            const minNumOwnedCards = pipe(
                knownDeductions.numCards,
                HM.get(owner.player),
                O.map(compose(
                    Struct_get('answer'),
                    Range.getMin,
                )),
            );

            const maxNumUnownedCards = O.map(
                minNumOwnedCards,
                (minNumOwnedCards) => HS.size(game.cards) - minNumOwnedCards,
            );

            return O.match(maxNumUnownedCards, {
                // We don't know their min number of cards
                onNone: constFalse,

                // We do know their min num cards, and we know what all those cards are
                onSome: EQ.equals(numUnownedCards),
            });
        }),

        // For these players, figure out which cards we DON'T know their ownership
        HM.map(compose(
            HM.keySet,
            HashSet_differenceFrom(game.cards),
        )),

        // Mark all these cards as UNOWNED by this player
        HashSet_fromHashMapMulti,
        HS.map(([owner, card]) =>
            DeductionSet.modifyAddOwnership(
                owner,
                card,

                true,

                Conclusion.Reason({
                    level: 'inferred',
                    explanation: `All except this player's min number of cards have been accounted for, so they definitely own the rest`,
                }),
            ),
        ),

        HS.values,
        ROA.fromIterable,

        // Convert them into a single modification
        DeductionSet.ModificationMonoid.combineAll,
    );

    return yield* $(modifyDeductions(knownDeductions));
});

// If indentify a card in the case file, it's none of the other ones of that type
export const caseFileHasAtMostOnePerCardType: DeductionRule =
    constant(
        T.fail(
            `DeductionRule caseFileHasAtMostOnePerCardType not implemented yet`,
        ),
    );

// If we eliminate all but 1 of a card of a type, then it's the remaining one
export const caseFileHasAtLeastOnePerCardType: DeductionRule =
    constant(
        T.fail(
            `DeductionRule caseFileHasAtLeastOnePerCardType not implemented yet`,
        ),
    );

// If someone has refuted a guess, then list the following assumed refute cards:
// - {player's known owned cards} & {guessed cards} ==> "(owned)"
// - {player's unknown ownerships} & {guess cards} ==> "(maybe)"
export const guessIsRefutedByHeldCard: DeductionRule =
    constant(
        T.fail(
            `DeductionRule guessIsRefutedByHeldCard not implemented yet`,
        ),
    );

// If a player has only 1 card left, that card is the intersection of any unknown refutes they've made
export const playerWith1CardRefutesWithIntersection: DeductionRule =
    constant(
        T.fail(
            `DeductionRule playerWith1CardRefutesWithIntersection not implemented yet`,
        ),
    );
