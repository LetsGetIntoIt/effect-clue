import * as EQ from '@effect/data/Equal';
import * as ROA from '@effect/data/ReadonlyArray';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as S from '@effect/data/String';
import * as TU from '@effect/data/Tuple';
import * as H from '@effect/data/Hash';
import * as HS from '@effect/data/HashSet';
import * as P from '@effect/data/Predicate';
import * as E from '@effect/data/Either';
import * as B from '@effect/data/Boolean';
import { pipe } from '@effect/data/Function';

import { Equals_getRefinement2, Equivalence_constTrue, HashSet_every, HashSet_getEquivalence, Predicate_Refinement_struct, Refinement_and, Refinement_or, Show, Show_isShow, Show_symbol } from '../utils/ShouldBeBuiltin';

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
        Predicate_Refinement_struct({
            level: P.compose(P.isString, pipe(
                Equals_getRefinement2('observed', S.Equivalence),
                Refinement_or(Equals_getRefinement2('inferred', S.Equivalence)),
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
        Predicate_Refinement_struct({
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

export const getEquivalence = <A>(eqvA: EQV.Equivalence<A>): EQV.Equivalence<Conclusion<A>> =>
    ST.getEquivalence({
        answer: eqvA,
        reasons: HashSet_getEquivalence(ReasonEquivalence),
    });

export const getEquivalenceIgnoreReasons = <A>(eqvA: EQV.Equivalence<A>): EQV.Equivalence<Conclusion<A>> =>
    ST.getEquivalence({
        answer: eqvA,

        // Ignore whether the reasons are equivalent or not
        reasons: Equivalence_constTrue,
    });

export const create = <A>(
    refA: P.Refinement<unknown, A>,
    eqvA: EQV.Equivalence<A>,
) => (
    answer: A,
    reasons: HS.HashSet<Reason>,
): E.Either<string, Conclusion<A>> =>
    // TODO maybe actually validate the cards?
    E.right({
        answer,
        reasons,

        [Show_symbol](): string {
           // TODO implement this
           return `Some Conclusion`;
        },
    
        [EQ.symbol](that: EQ.Equal): boolean {
            return getRefinement(refA)(that)
                && getEquivalence(eqvA)(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const combine = <A>(
    refA: P.Refinement<unknown, A>,
    eqvA: EQV.Equivalence<A>,
) => (
    that: Conclusion<A>
) =>
(self: Conclusion<A>):
E.Either<string, Conclusion<A>> =>
    pipe(
        // Check if the two Conclusion values are equal
        getEquivalenceIgnoreReasons(eqvA)(self, that),

        B.match(
            // They are unequal. Return an error
            // TODO return a structured error
            () => E.left('Conflicting Conclusion!'),

            // They are equal. Merge the two Conclusions
            () => create(refA, eqvA)(
                // Use either Conclusion's value
                self.answer,

                // Merge their reasons
                HS.union(self.reasons, that.reasons),
            ),
        ),
    );
