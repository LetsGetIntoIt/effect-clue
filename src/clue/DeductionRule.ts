import { T, B, SG, MON, HM, HS, ROA, N } from '../utils/EffectImports';
import { constant, pipe, flow } from '@effect/data/Function';
import { Effect_getSemigroupCombine, Function_getSemigroup, HashSet_fromHashMapMulti, HashSet_isSize, Struct_get } from '../utils/ShouldBeBuiltin';

import * as Game from "./Game";
import * as ConclusionMapSet from "./ConclusionMapSet";
import * as CardOwnership from './CardOwnership';
import * as Conclusion from './Conclusion';
import * as GuessSet from './GuessSet';
import * as Range from './Range';

export type DeductionRule = (
    // Accepts a set of "known" conclusions
    knownConclusions: ConclusionMapSet.ValidatedConclusionMapSet
) => T.Effect<
    // Accepts the objects in the game
    | Game.Game

    // Accepts the set of gueses that have been made
    | GuessSet.ValidatedGuessSet
,
    // Returns an error if we encounter a logical contradiction
    B.Brand.BrandErrors
,
    // Returns the set of conclusions, augmented with new findings
    ConclusionMapSet.ValidatedConclusionMapSet
>;

export const constEmpty: DeductionRule =
    constant(T.succeed(ConclusionMapSet.empty));

export const SemigroupUnion: SG.Semigroup<DeductionRule> = 
    Function_getSemigroup(
        Effect_getSemigroupCombine<
            ConclusionMapSet.ValidatedConclusionMapSet,
            B.Brand.BrandErrors,
            Game.Game | GuessSet.ValidatedGuessSet
        >(
            (first, second) => pipe(
                first,
                ConclusionMapSet.modifyCombine(second),
            ),
        ),
    )();

export const MonoidUnion: MON.Monoid<DeductionRule> = MON.fromSemigroup(
    SemigroupUnion,
    constEmpty,
);

// Every player has at least 0 cards, of course!
export const playerHasAtLeastZeroCards: DeductionRule =
    constant(
        T.fail(
            B.error(`DeductionRule playerHasAtLeastZeroCards not implemented yet`),
        ),
    );

// A player can have at most TOTAL_NUM_CARDS - SUM(OTHER_PLAYER.MIN_NUM_CARDS)
export const playerHasMaxNumCardsRemaining: DeductionRule = (
    knownConclusions,
) => T.gen(function* ($) {
    const game = yield* $(Game.Tag);

    // Get the total number of cards in the game
    const totalNumCards = HS.size(game.cards);

    // How many are in the case file?
    // TODO this logic will need to update if case files can have more of any type of card
    const caseFileNumCards = HS.size(Game.cardTypes(game));

    // How many cards do all players have at a minimum?
    const minPlayerNumCards = pipe(
        knownConclusions.numCards,
        HM.map(flow(Struct_get('answer'), Range.min)),
        HM.values,
        N.MonoidSum.combineAll,
    );

    // What is the maximum number of cards any player has?
    const maxNumCards = totalNumCards - caseFileNumCards - minPlayerNumCards;

    // TODO update our knowledge about each player's number of cards
    return yield* $(T.fail(
        B.error(`DeductionRule playerHasAtMostNumCards not implemented yet`),
    ));
});

// A player must have at least as many cards as required to make all their refutations
export const playerHasMinNumCardsRefuted: DeductionRule =
    // Filter down to all the guesses they have refuted, where we DON'T know which card they refuted with
    // Initialize MIN_NUM_CARDS=0 OR_CARDS={}
    // For each guess:
    //      If this has any overlap with existing OR_CARDS, ignore it and move on
    //      Else
    //          MIN_NUM_CARDS++
    //          OR_CARDS union= guessed cards
    // If the new minimum exceeds the max, is that a problem?
    constant(
        T.fail(
            B.error(`DeductionRule playerHasMinNumCardsRefuted not implemented yet`),
        ),
    );

// If a card is held by an owner, it cannot be held by anyone else
export const cardIsHeldAtMostOnce: DeductionRule = (
    knownConclusions,
) => T.gen(function* ($) {
    const game = yield* $(Game.Tag);
    const gameOwners = Game.owners(game);

    const ownershipByCard = ConclusionMapSet.getOwnershipByCard(knownConclusions);

    // For each card that is owned, mark it as NOT owned by any owner left blank
    const modifyConclusions = pipe(
        ownershipByCard,

        // Keep only the cards with a known owner
        HM.filter(CardOwnership.isOwned),

        // Figure out the owners we DON'T know about
        HM.map(flow(
            // Put together a set of all the owners we know about
            ({ owner, nonOwners }) => HS.add(nonOwners, owner),

            // Find the difference from all owners in the game
            // This is the owners that are blank for this card
            known => HS.difference(gameOwners, known),
        )),

        // Convert to a nice set of pairs
        HashSet_fromHashMapMulti,

        // Now put together all the modifications we need to apply
        HS.map(([card, owner]) =>
            ConclusionMapSet.modifyAddOwnership(
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
        ConclusionMapSet.ModificationMonoid.combineAll,
    );

    return yield* $(modifyConclusions(knownConclusions));
});

// TODO reduce duplication with the other card holding rule
// If a card is held by everyone except one, then it's held by that one
export const cardIsHeldAtLeastOnce: DeductionRule = (
    knownConclusions,
) => T.gen(function* ($) {
    const game = yield* $(Game.Tag);
    const gameOwners = Game.owners(game);

    const ownershipByCard = ConclusionMapSet.getOwnershipByCard(knownConclusions);

    // For each card that is not owned, if there is a single unknown, mark it as OWNED
    const modifyConclusions = pipe(
        ownershipByCard,

        // Keep only the cards with a known owner
        HM.filter(CardOwnership.isUnowned),

        // Figure out the owners we DON'T know about
        HM.map(({ nonOwners }) => HS.difference(gameOwners, nonOwners)),

        // Keep only the cards that have exactly 1 unknown owner
        HM.filter(HashSet_isSize(1)),

        // Convert to a nice set of pairs
        HashSet_fromHashMapMulti,

        // Now put together all the modifications we need to apply
        HS.map(([card, owner]) =>
            ConclusionMapSet.modifyAddOwnership(
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
        ConclusionMapSet.ModificationMonoid.combineAll,
    );

    return yield* $(modifyConclusions(knownConclusions));
});

export const cardIsHeldExactlyOnce: DeductionRule =
    SemigroupUnion.combine(cardIsHeldAtMostOnce, cardIsHeldAtLeastOnce);

// If all of a player's cards are accounted for, they don't have any others
export const playerHasAtMostNumCards: DeductionRule =
    constant(
        T.fail(
            B.error(`DeductionRule playerHasAtMostNumCards not implemented yet`),
        ),
    );

// If all of a player's missing cards are accounted for (the number that will be missing), they have all the others
export const playerHasAtLeastNumCards: DeductionRule =
    constant(
        T.fail(
            B.error(`DeductionRule playerHasAtLeastNumCards not implemented yet`),
        ),
    );

export const playerHasExactlyNumCards: DeductionRule =
    SemigroupUnion.combine(playerHasAtMostNumCards, playerHasAtLeastNumCards);

// If indentify a card in the case file, it's none of the other ones of that type
export const caseFileHasAtMostOnePerCardType: DeductionRule =
    constant(
        T.fail(
            B.error(`DeductionRule caseFileHasAtMostOnePerCardType not implemented yet`),
        ),
    );

// If we eliminate all but 1 of a card of a type, then it's the remaining one
export const caseFileHasAtLeastOnePerCardType: DeductionRule =
    constant(
        T.fail(
            B.error(`DeductionRule caseFileHasAtLeastOnePerCardType not implemented yet`),
        ),
    );

export const caseFileHasExactlyOnePerCardType: DeductionRule =
    SemigroupUnion.combine(caseFileHasAtMostOnePerCardType, caseFileHasAtLeastOnePerCardType);

// If someone has refuted a guess, then list the following assumed refute cards:
// - {player's known owned cards} & {guessed cards} ==> "(owned)"
// - {player's unknown ownerships} & {guess cards} ==> "(maybe)"
export const guessIsRefutedByHeldCard: DeductionRule =
    constant(
        T.fail(
            B.error(`DeductionRule guessIsRefutedByHeldCard not implemented yet`),
        ),
    );

// If a player has only 1 card left, that card is the intersection of any unknown refutes they've made
export const playerWith1CardRefutesWithIntersection: DeductionRule =
    constant(
        T.fail(
            B.error(`DeductionRule playerWith1CardRefutesWithIntersection not implemented yet`),
        ),
    );
