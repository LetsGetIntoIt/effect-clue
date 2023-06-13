import * as EQ from '@effect/data/Equal';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as S from '@effect/data/String';
import * as H from '@effect/data/Hash';
import * as HS from '@effect/data/HashSet';
import * as P from '@effect/data/Predicate';
import * as E from '@effect/data/Either';
import * as B from '@effect/data/Boolean';
import * as M from '@effect/match';
import { constant, pipe } from '@effect/data/Function';

import { Equals_getRefinement, Equivalence_constTrue, HashSet_every, HashSet_getEquivalence, Refinement_struct, Refinement_and, Refinement_or, Show, Show_isShow, Show_symbol, Show_show, Show_showHashSet } from '../utils/ShouldBeBuiltin';

/**
 * Why do we know something?
 * Did we directly observe it, or infer it?
 * What specifically caused us to know this thing?
 */
export type Reason = EQ.Equal & Show & {
    level: 'observed' | 'inferred';
    explanation: string;
}

const ReasonEquivalence: EQV.Equivalence<Reason> = ST.getEquivalence({
    level: S.Equivalence,
    explanation: S.Equivalence,
});

const isReason: P.Refinement<unknown, Reason> =
    pipe(
        Refinement_struct({
            level: P.compose(P.isString, pipe(
                Equals_getRefinement('observed'),
                Refinement_or(Equals_getRefinement('inferred')),
            )),

            explanation: P.isString,
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

/**
 * Something that we know
 * A - the thing we know
 * Reasons - the reasons we know this
 */
export type Conclusion<A> = {
    answer: A,
    reasons: HS.HashSet<Reason>;
}

export const getRefinement = <A>(refA: P.Refinement<unknown, A>): P.Refinement<unknown, Conclusion<A>> =>
    pipe(
        Refinement_struct({
            answer: refA,
            reasons: pipe(
                HS.isHashSet,
                P.compose(HashSet_every(isReason)),
            ),
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const isConclusion: P.Refinement<unknown, Conclusion<unknown>> =
    getRefinement(P.isUnknown);

export const Equivalence: EQV.Equivalence<Conclusion<unknown>> =
    ST.getEquivalence({
        answer: EQ.equivalence(),
        reasons: HashSet_getEquivalence(ReasonEquivalence),
    });

export const EquivalenceIgnoreReasons: EQV.Equivalence<Conclusion<unknown>> =
    ST.getEquivalence({
        answer: EQ.equivalence(),

        // Ignore whether the reasons are equivalent or not
        reasons: Equivalence_constTrue,
    });

export const create = <A>(
    answer: A,
    reasons: HS.HashSet<Reason>,
): E.Either<string, Conclusion<A>> =>
    E.right({
        answer,
        reasons,

        [Show_symbol](): string {
           return `${Show_show(answer)} because ${Show_showHashSet(reasons)}`;
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isConclusion(that)
                && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const combine = <A>(
    collisionStrategy: 'overwrite' | 'fail',
) => (
    newConclusion: Conclusion<A>,
) => (
    oldConclusion: Conclusion<A>,
): E.Either<string, Conclusion<A>> =>
    pipe(
        EquivalenceIgnoreReasons(newConclusion, oldConclusion),

        B.match(
            // The values are not equal
            constant(pipe(
                M.value(collisionStrategy),

                // If the strategy is to overwrite, just use the new conclusion
                M.when('overwrite',  () => E.right(newConclusion)),

                // If the strategy is to fail, do so
                M.when('fail', () => E.left(`New conclusion ${Show_show(newConclusion)} conflicts with existing conclusion ${Show_show(oldConclusion)}`)),

                M.exhaustive,
            )),

            // The values are equal, so just merge the reasons
            () => create(
                newConclusion.answer,
                HS.union(newConclusion.reasons, oldConclusion.reasons),
            ),
        ),
    );
