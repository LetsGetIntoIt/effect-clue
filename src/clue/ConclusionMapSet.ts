
import { D, HM, B, T, CTX, BOOL, HS, E, SG, MON, ST } from '../utils/EffectImports';
import { pipe, flow, constant } from '@effect/data/Function';
import { Struct_get, HashSet_of, Brand_refinedEffect, HashMap_setOrUpdate } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as Player from './Player';
import * as Guess from './Guess';
import * as Game from './Game';
import * as CardOwner from './CardOwner';
import * as CardOwnership from './CardOwnership';
import * as Conclusion from './Conclusion';
import * as ConclusionMap from './ConclusionMap';
import * as Range from './Range';

export interface ConclusionMapSet extends D.Case {
    _tag: "ConclusionMapSet";
    numCards: ConclusionMap.ValidatedConclusionMap<Player.Player, Range.Range>;
    ownership: ConclusionMap.ValidatedConclusionMap<D.Data<[CardOwner.CardOwner, Card.Card]>, boolean>;
    refuteCards: ConclusionMap.ValidatedConclusionMap<Guess.Guess, HM.HashMap<Card.Card, 'owned' | 'maybe'>>;
};

export const ConclusionMapSet = D.tagged<ConclusionMapSet>("ConclusionMapSet");

export type ValidatedConclusionMapSet = ConclusionMapSet & B.Brand<'ValidatedConclusionMapSet'>;

export const ValidatedConclusionMapSet = Brand_refinedEffect<ValidatedConclusionMapSet, Game.Game>(
    T.gen(function* ($) {
        return [
            // TODO actually validate the conclusions
            // - all Cards and Players actually exist in the game
            // - all Guesses actaully exist in the Game
            // - numCards cannot exceed total number of cards - where do we read that info from?
            // - card can be owned by at most 1 owner
            // - casefile can own at most 1 of each card type
            // - refuteCards must satisfy this requirement
            //   - {player's known owned cards} & {guessed cards} ==> "(owned)"
            //   - {player's unknown ownerships} & {guess cards} ==> "(maybe)"
        ];
    }),
);

export const Tag = CTX.Tag<ValidatedConclusionMapSet>();

export const empty: ValidatedConclusionMapSet =
    pipe(
        ConclusionMapSet({
            numCards: ConclusionMap.empty(),
            ownership: ConclusionMap.empty(),
            refuteCards: ConclusionMap.empty(),
        }),

        ValidatedConclusionMapSet,

        // We just need an empty game
        T.provideService(Game.Tag, Game.emptyStandard),

        // If creating an empty deduction set errors, it is a defects in the underlying code,
        // not tagged errors that should be handled by the user
        T.runSync,
    );

// TODO store this on the ValidatedConclusionMapSet itself, rather than recomputing it each time
export const getOwnershipByCard: (
    conclusions: ValidatedConclusionMapSet,
) => HM.HashMap<Card.Card, CardOwnership.CardOwnership> =
    flow(
        // Pluck out the actual HashMap we care about
        Struct_get('ownership'),

        // We don't care about the conclusions and reasons, just whether its owned or not
        HM.map(({ answer }) => answer),

        HM.reduceWithIndex(
            HM.empty(),

            (ownershipByCard, isOwned, [owner, card]) => {
                const newOwnership = pipe(
                    isOwned,

                    // TODO make better constructors for these
                    BOOL.match(
                        constant(CardOwnership.CardOwnershipUnowned({
                            nonOwners: HashSet_of(owner),
                        })),

                        constant(CardOwnership.CardOwnershipOwned({
                            owner,
                            nonOwners: HS.empty(),
                        })),
                    ),
                );

                return HashMap_setOrUpdate(
                    card,

                    // If this card doesn't exist in the map yet
                    constant(newOwnership),

                    // If we already have ownership information for the card
                    flow(CardOwnership.combine(newOwnership), E.getOrThrow),
                )(
                    ownershipByCard,
                )
            },
        )
    );

export type Modification = ((conclusions: ValidatedConclusionMapSet) => T.Effect<Game.Game, B.Brand.BrandErrors, ValidatedConclusionMapSet>);

export const identity: Modification =
    T.succeed;

export const ModificationSemigroup: SG.Semigroup<Modification> =
    SG.make((modifyFirst, modifySecond) => (first) => T.gen(function* ($) {
        const second = yield* $(modifyFirst(first));
        return yield* $(modifySecond(second));
    }));

export const ModificationMonoid: MON.Monoid<Modification> = MON.fromSemigroup(
    ModificationSemigroup,
    identity,
);

export const modifyAddNumCardsExact =
        (player: Player.Player, numCards: number, reason: Conclusion.Reason):
        Modification =>
    flow(
        ST.pick('numCards', 'ownership', 'refuteCards'),

        ST.evolve({
            numCards: ConclusionMap.setMergeOrFail(player, Range.Range(numCards), HashSet_of(reason)),
            ownership: (_) => E.right(_),
            refuteCards: (_) => E.right(_),
        }),
        E.struct,

        T.map(ConclusionMapSet),
        T.flatMap(ValidatedConclusionMapSet),
    );

export const modifyAddOwnership =
        (owner: CardOwner.CardOwner, card: Card.Card, isOwned: boolean, reason: Conclusion.Reason):
        Modification =>
    flow(
        ST.pick('numCards', 'ownership', 'refuteCards'),

        ST.evolve({
            numCards: (_) => E.right(_),
            ownership: ConclusionMap.setMergeOrFail(D.array([owner, card] as const), isOwned, HashSet_of(reason)),
            refuteCards: (_) => E.right(_),
        }),
        E.struct,

        T.map(ConclusionMapSet),
        T.flatMap(ValidatedConclusionMapSet),
    );

export const modifySetRefuteCards =
        (guess: Guess.Guess, possibleCards: HM.HashMap<Card.Card, 'owned' | 'maybe'>, reason: Conclusion.Reason):
        Modification =>
    flow(
        ST.pick('numCards', 'ownership', 'refuteCards'),

        ST.evolve({
            numCards: (_) => E.right(_),
            ownership: (_) => E.right(_),
            refuteCards: ConclusionMap.setMergeOrOverwrite(guess, possibleCards, HashSet_of(reason)),
        }),
        E.struct,

        T.map(ConclusionMapSet),
        T.flatMap(ValidatedConclusionMapSet),
    );

export const modifyCombine = (
    second: ConclusionMapSet,
): Modification => (first) =>
    pipe(
        first,

        ST.pick('numCards', 'ownership', 'refuteCards'),

        ST.evolve({
            numCards: ConclusionMap.combineMergeOrFail(second.numCards),
            ownership: ConclusionMap.combineMergeOrFail(second.ownership),
            refuteCards: ConclusionMap.combineMergeOrFail(second.refuteCards),
        }),
        E.struct,

        T.map(ConclusionMapSet),
        T.flatMap(ValidatedConclusionMapSet),
    );
