import * as EQ from '@effect/data/Equal';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as S from '@effect/data/String';
import * as H from '@effect/data/Hash';
import * as HS from '@effect/data/HashSet';
import * as P from '@effect/data/Predicate';
import * as E from '@effect/data/Either';
import * as B from '@effect/data/Boolean';
import { pipe } from '@effect/data/Function';

import { Equals_getRefinement2, Equivalence_constTrue, HashSet_every, HashSet_getEquivalence, Refinement_struct, Refinement_and, Refinement_or, Show, Show_isShow, Show_symbol, Show_show, Show_showHashSet } from '../utils/ShouldBeBuiltin';

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
    // TODO maybe actually validate the cards?
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
    that: Conclusion<A>
) =>
(self: Conclusion<A>):
E.Either<string, Conclusion<A>> =>
    pipe(
        // Check if the two Conclusion values are equal
        EquivalenceIgnoreReasons(self, that),

        B.match(
            // They are unequal. Return an error
            // TODO return a structured error
            () => E.left('Conflicting Conclusion!'),

            // They are equal. Merge the two Conclusions
            () => create(
                // Use either Conclusion's value
                self.answer,

                // Merge their reasons
                HS.union(self.reasons, that.reasons),
            ),
        ),
    );
