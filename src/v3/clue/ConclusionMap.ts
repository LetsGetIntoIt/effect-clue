import * as EQ from '@effect/data/Equal';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as H from '@effect/data/Hash';
import * as HM from '@effect/data/HashMap';
import * as P from '@effect/data/Predicate';
import * as E from '@effect/data/Either';
import { constant, pipe } from '@effect/data/Function';

import { HashMap_every, HashMap_getEquivalence, Refinement_and, Refinement_struct, Show, Show_isShow, Show_showHashMap, Show_symbol } from '../utils/ShouldBeBuiltin';

import * as Conclusion from './Conclusion';

/**
 * Something that we know about a specific topic
 * Q - the topic that we know about
 * Conclusion - the conclusion we have about that topic
 */
export type ConclusionMap<Q, A> =
    EQ.Equal & Show & {
        conclusions: HM.HashMap<Q, Conclusion.Conclusion<A>>;
    };

export const getRefinement = <Q, A>(refQ: P.Refinement<unknown, Q>, refA: P.Refinement<unknown, A>): P.Refinement<unknown, ConclusionMap<Q, A>> =>
    pipe(
        Refinement_struct({
            conclusions: pipe(
                HM.isHashMap,
                P.compose(
                    HashMap_every(refQ, Conclusion.getRefinement(refA)),
                ),
            ),
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const isConclusionMap: P.Refinement<unknown, ConclusionMap<unknown, unknown>> =
    getRefinement(P.isUnknown, P.isUnknown);

export const Equivalence: EQV.Equivalence<ConclusionMap<unknown, unknown>> =
    ST.getEquivalence({
        conclusions: HashMap_getEquivalence(EQ.equivalence(), EQ.equivalence()),
    });

const create = <Q, A>(
    conclusions: HM.HashMap<Q, Conclusion.Conclusion<A>>
): ConclusionMap<Q, A> =>
    ({
        conclusions,

        [Show_symbol](): string {
           return Show_showHashMap(this.conclusions);
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isConclusionMap(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const empty = <Q, A>(): ConclusionMap<Q, A> =>
    create(HM.empty());

export const setAddOrFail = <A>(
    addOrFail: (answer: A, prevAnswer: A) => E.Either<string, A>,
) => <Q>(
    question: Q,
) => (
    answer: A,
    reason: Conclusion.Reason,
): ((conclusions: ConclusionMap<Q, A>) => E.Either<string, ConclusionMap<Q, A>>) =>
    null;

export const add = <Q>(
    question: Q
): (
    <A>(answer: A, reason: Conclusion.Reason) =>
    ((conclusions: ConclusionMap<Q, A>) =>
    E.Either<string, ConclusionMap<Q, A>>)
) =>
    setAddOrFail(constant(E.left('conflicting answers')));

export const set = <Q>(
    question: Q
): (
    <A>(answer: A, reason: Conclusion.Reason) =>
    ((conclusions: ConclusionMap<Q, A>) => E.Either<string, ConclusionMap<Q, A>>)
) =>
    setAddOrFail(E.right);
