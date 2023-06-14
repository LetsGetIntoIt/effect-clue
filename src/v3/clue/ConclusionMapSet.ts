import * as EQ from '@effect/data/Equal';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as H from '@effect/data/Hash';
import * as HM from '@effect/data/HashMap';
import * as P from '@effect/data/Predicate';
import * as E from '@effect/data/Either';
import * as T from '@effect/io/Effect';
import { flow, pipe } from '@effect/data/Function';

import { Refinement_and, Refinement_struct, Show, Show_isShow, Show_show, Show_symbol, HashMap_every, Equals_getRefinement, Refinement_or } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as Player from './Player';
import * as Guess from './Guess';
import * as Game from './Game';
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
        ownership: ConclusionMap.ConclusionMap<CardOwnership.CardOwnership, boolean>;
        refuteCards: ConclusionMap.ConclusionMap<Guess.Guess, HM.HashMap<Card.Card, 'owned' | 'maybe'>>;
    };

export const isConclusionMapSet: P.Refinement<unknown, ConclusionMapSet> =
    pipe(
        Refinement_struct({
            numCards: ConclusionMap.getRefinement(Player.isPlayer, P.isNumber),

            ownership: ConclusionMap.getRefinement(CardOwnership.isCardOwnership, P.isBoolean),

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
    ownership: ConclusionMap.ConclusionMap<CardOwnership.CardOwnership, boolean>,
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

export const combine = (
    {
        numCards: thatNumCards,
        ownership: thatOwnership,
        refuteCards: thatRefuteCards,
    }: ConclusionMapSet,
) => (
    {
        numCards: selfNumCards,
        ownership: selfOwnership,
        refuteCards: selfRefuteCards,
    }: ConclusionMapSet,
): T.Effect<Game.Game, string, ConclusionMapSet> =>
    create({
        numCards: ConclusionMap.union(selfNumCards, thatNumCards),
        ownership: ConclusionMap.union(selfOwnership, thatOwnership),
        refuteCards: ConclusionMap.union(selfRefuteCards, thatRefuteCards),
    });

export const addNumCards =
        (player: Player.Player, numCards: number, reason: Conclusion.Reason):
        ((conclusions: ConclusionMapSet) => T.Effect<Game.Game, string, ConclusionMapSet>) =>
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

export const addOwnership =
        (ownership: CardOwnership.CardOwnership, isOwned: boolean, reason: Conclusion.Reason):
        ((conclusions: ConclusionMapSet) => T.Effect<Game.Game, string, ConclusionMapSet>) =>
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

export const setRefuteCards =
        (guess: Guess.Guess, possibleCards: HM.HashMap<Card.Card, 'owned' | 'maybe'>, reason: Conclusion.Reason):
        ((conclusions: ConclusionMapSet) => T.Effect<Game.Game, string, ConclusionMapSet>) =>
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
