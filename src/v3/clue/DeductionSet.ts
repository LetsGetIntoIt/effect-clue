import * as EQ from '@effect/data/Equal';
import * as ROA from '@effect/data/ReadonlyArray';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as S from '@effect/data/String';
import * as TU from '@effect/data/Tuple';
import * as H from '@effect/data/Hash';
import * as HS from '@effect/data/HashSet';
import * as HM from '@effect/data/HashMap';
import * as P from '@effect/data/Predicate';
import * as E from '@effect/data/Either';
import * as B from '@effect/data/Boolean';
import { flow, pipe } from '@effect/data/Function';

import { Show, Show_show, Show_symbol } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as Player from './Player';
import * as Guess from './Guess';
import * as CardHolder from './CardHolder';
import * as Conclusion from './Conclusion';
import * as ConclusionMap from './ConclusionMap';

/**
 * Something that we know about a specific topic
 * Q - the topic that we know about
 * Conclusion - the conclusion we have about that topic
 */
export type DeductionSet =
    EQ.Equal & Show & {
        numCards: ConclusionMap.ConclusionMap<Player.Player, number>;
        holdings: ConclusionMap.ConclusionMap<[CardHolder.CardHolder, Card.Card], boolean>;
        refuteCards: ConclusionMap.ConclusionMap<Guess.Guess, OrHashSet<Card.Card>>;
    };

const create = (deductions : {
    numCards: ConclusionMap.ConclusionMap<Player.Player, number>,
    holdings: ConclusionMap.ConclusionMap<[CardHolder.CardHolder, Card.Card], boolean>,
    refuteCards: ConclusionMap.ConclusionMap<Guess.Guess, OrHashSet<Card.Card>>,
}): E.Either<string, DeductionSet> => pipe(
    // TODO actually validate the deductions

    E.right({
        ...deductions,

        [Show_symbol](): string {
           return `We have deduced numCards ${Show_show(this.numCards)} and holdings ${Show_show(this.holdings)} and refutations: ${Show_show(this.refuteCards)}`;
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isCard(that)
                && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    }),
);

export const empty: DeductionSet =
    pipe(
        create({
            numCards: ConclusionMap.empty(),
            holdings: ConclusionMap.empty(),
            refuteCards: ConclusionMap.empty(),
        }),

        // If creating an empty deduction set errors, it is a defects in the underlying code,
        // not tagged errors that should be handled by the user
        E.getOrThrow,
    );

export const setNumCards =
        (player: Player.Player, numCards: number, reason: Conclusion.Reason) =>
        (deductions: DeductionSet):
        E.Either<string, DeductionSet> =>
    // TODO how do we validate that we haven't exceeded the total number of cards of each type?
    //      where should the CardSet data be accessed from?
    null;

export const setHolding =
        (holder: CardHolder.CardHolder, card: Card.Card, isHolding: boolean, reason: Conclusion.Reason) =>
        (deductions: DeductionSet):
        E.Either<string, DeductionSet> =>
    null;

export const setRefuteCards =
        (guess: Guess.Guess, possibleCards: OrHashSet<Card.Card>) =>
        (deductions: DeductionSet):
        E.Either<string, DeductionSet> =>
    // TODO use typings to ensure that we are only modifying refuted guesses
    // TODO validate that this is a subset of "Player's known held cards" - "Guessed cards"
    null;
