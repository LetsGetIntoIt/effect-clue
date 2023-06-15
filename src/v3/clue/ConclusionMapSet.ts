import * as EQ from '@effect/data/Equal';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as H from '@effect/data/Hash';
import * as HM from '@effect/data/HashMap';
import * as HS from '@effect/data/HashSet';
import * as P from '@effect/data/Predicate';
import * as E from '@effect/data/Either';
import * as T from '@effect/io/Effect';
import * as CTX from "@effect/data/Context";
import * as O from '@effect/data/Option';
import * as TU from '@effect/data/Tuple';
import * as SG from '@effect/data/typeclass/Semigroup';
import * as MON from '@effect/data/typeclass/Monoid';
import { flow, pipe } from '@effect/data/Function';

import { Refinement_and, Refinement_struct, Show, Show_isShow, Show_show, Show_symbol, HashMap_every, Equals_getRefinement, Refinement_or } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as Player from './Player';
import * as Guess from './Guess';
import * as Game from './Game';
import * as CardOwner from './CardOwner';
import * as CardOwnerCardPair from './CardOwnerCardPair';
import * as CardOwnership from './CardOwnership';
import * as Conclusion from './Conclusion';
import * as ConclusionMap from './ConclusionMap';

/**
 * Something that we know about a specific topic
 * Q - the topic that we know about
 * Conclusion - the conclusion we have about that topic
 */
export type ConclusionMapSet =
    EQ.Equal & Show & {
        numCards: ConclusionMap.ConclusionMap<Player.Player, number>;
        ownership: ConclusionMap.ConclusionMap<CardOwnerCardPair.CardOwnerCardPair, boolean>;
        refuteCards: ConclusionMap.ConclusionMap<Guess.Guess, HM.HashMap<Card.Card, 'owned' | 'maybe'>>;
    };

export const Tag = CTX.Tag<ConclusionMapSet>();

export const isConclusionMapSet: P.Refinement<unknown, ConclusionMapSet> =
    pipe(
        Refinement_struct({
            numCards: ConclusionMap.getRefinement(Player.isPlayer, P.isNumber),

            ownership: ConclusionMap.getRefinement(CardOwnerCardPair.isCardOwnerCardPair, P.isBoolean),

            refuteCards: ConclusionMap.getRefinement(
                Guess.isGuess,
                pipe(
                    HM.isHashMap,
                    P.compose(HashMap_every(
                        Card.isCard,
                        pipe(Equals_getRefinement('owned'), Refinement_or(Equals_getRefinement('maybe'))),
                    )),
                ),
            ),
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<ConclusionMapSet> =
    ST.getEquivalence({
        numCards: ConclusionMap.Equivalence,
        ownership: ConclusionMap.Equivalence,
        refuteCards: ConclusionMap.Equivalence,
    });

const create = (conclusions : {
    numCards: ConclusionMap.ConclusionMap<Player.Player, number>,
    ownership: ConclusionMap.ConclusionMap<CardOwnerCardPair.CardOwnerCardPair, boolean>,
    refuteCards: ConclusionMap.ConclusionMap<Guess.Guess, HM.HashMap<Card.Card, 'owned' | 'maybe'>>,
}): T.Effect<Game.Game, string, ConclusionMapSet> => pipe(
    // TODO actually validate the conclusions
    // - all Cards and Players actually exist in the GameSetup
    // - all Guesses actaully exist in the Game
    // - numCards cannot exceed total number of cards - where do we read that info from?
    // - card can be owned by at most 1 owner
    // - casefile can own at most 1 of each card type
    // - refuteCards must satisfy this requirement
    //   - {player's known owned cards} & {guessed cards} ==> "(owned)"
    //   - {player's unknown ownerships} & {guess cards} ==> "(maybe)"

    E.right({
        ...conclusions,

        [Show_symbol](): string {
           return `We have deduced numCards ${Show_show(this.numCards)} and ownership ${Show_show(this.ownership)} and refutations: ${Show_show(this.refuteCards)}`;
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isConclusionMapSet(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    }),
);

export const empty: ConclusionMapSet =
    pipe(
        create({
            numCards: ConclusionMap.empty(),
            ownership: ConclusionMap.empty(),
            refuteCards: ConclusionMap.empty(),
        }),

        // We just need an empty game
        T.provideService(Game.Tag, Game.empty),

        // If creating an empty deduction set errors, it is a defects in the underlying code,
        // not tagged errors that should be handled by the user
        T.runSync,
    );

// TODO store this insead as a HashMap<Card.Card, ...> on the object itself, rather than recomputing it each time
export const getOwnershipOf = (
    conclusions: ConclusionMapSet,
) => (
    card: Card.Card,
): CardOwnership.CardOwnership =>
    null;

export type Modification = ((conclusions: ConclusionMapSet) => T.Effect<Game.Game, string, ConclusionMapSet>);

export const modifyIdentity: Modification =
    T.succeed;

export const ModificationSemigroup: SG.Semigroup<Modification> =
    SG.make((modifyFirst, modifySecond) => (first) => T.gen(function* ($) {
        const second = yield* $(modifyFirst(first));
        return yield* $(modifySecond(second));
    }));

export const ModificationMonoid: MON.Monoid<Modification> = MON.fromSemigroup(
    ModificationSemigroup,
    modifyIdentity,
);

export const modifyAddNumCards =
        (player: Player.Player, numCards: number, reason: Conclusion.Reason):
        Modification =>
    flow(
        ST.pick('numCards', 'ownership', 'refuteCards'),

        ST.evolve({
            numCards: ConclusionMap.add(player, numCards, reason),
            ownership: (_) => E.right(_),
            refuteCards: (_) => E.right(_),
        }),
        E.struct,

        T.flatMap(create),
    );

export const modifyAddOwnership =
        (ownership: CardOwnerCardPair.CardOwnerCardPair, isOwned: boolean, reason: Conclusion.Reason):
        Modification =>
    flow(
        ST.pick('numCards', 'ownership', 'refuteCards'),

        ST.evolve({
            numCards: (_) => E.right(_),
            ownership: ConclusionMap.add(ownership, isOwned, reason),
            refuteCards: (_) => E.right(_),
        }),
        E.struct,

        T.flatMap(create),
    );

export const modifySetRefuteCards =
        (guess: Guess.Guess, possibleCards: HM.HashMap<Card.Card, 'owned' | 'maybe'>, reason: Conclusion.Reason):
        Modification =>
    flow(
        ST.pick('numCards', 'ownership', 'refuteCards'),

        ST.evolve({
            numCards: (_) => E.right(_),
            ownership: (_) => E.right(_),
            refuteCards: ConclusionMap.set(guess, possibleCards, reason),
        }),
        E.struct,

        T.flatMap(create),
    );

// TODO don't just union thes. This overwrites old values. Instead, actually apply each modification
export const modifyCombine = (
    {
        numCards: thatNumCards,
        ownership: thatOwnership,
        refuteCards: thatRefuteCards,
    }: ConclusionMapSet,
): Modification => (
    {
        numCards: selfNumCards,
        ownership: selfOwnership,
        refuteCards: selfRefuteCards,
    }
) =>
    create({
        numCards: ConclusionMap.combine(selfNumCards, thatNumCards),
        ownership: ConclusionMap.combine(selfOwnership, thatOwnership),
        refuteCards: ConclusionMap.combine(selfRefuteCards, thatRefuteCards),
    });
