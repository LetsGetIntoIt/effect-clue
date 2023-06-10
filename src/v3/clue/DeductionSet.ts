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

import { Show } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as Player from './Player';
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
        refuteCards: ConclusionMap.ConclusionMap<Guess.RefutedUnknownGuess, OrHashSet<Card>>;
    };

const create = (deductions : {
    numCards: ConclusionMap.ConclusionMap<Player.Player, number>,
    holdings: ConclusionMap.ConclusionMap<[CardHolder.CardHolder, Card.Card], boolean>,
    refuteCards: ConclusionMap.ConclusionMap<Guess.RefutedUnknownGuess, OrHashSet<Card>>,
}): DeductionSet => ({
    ...deductions,
});

export const empty: DeductionSet = create({
    numCards: ConclusionMap.empty(),
    holdings: ConclusionMap.empty(),
    refuteCards: ConclusionMap.empty(),
});

export const setNumCards =
        (player: Player.Player, numCards: number, reason: Conclusion.Reason) =>
        (deductions: DeductionSet):
        E.Either<string, DeductionSet> =>
    null;

export const setHolding =
        (holder: CardHolder.CardHolder, card: Card.Card, isHolding: boolean, reason: Conclusion.Reason) =>
        (deductions: DeductionSet):
        E.Either<string, DeductionSet> =>
    null;

export const setRefuteCards =
        (guess: Guess.RefutedUnknownGuess, possibleCards: OrHashSet<Card.Card>) =>
        (deductions: DeductionSet):
        E.Either<string, DeductionSet> =>
    null;
