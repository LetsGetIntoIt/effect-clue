import * as EQ from '@effect/data/Equal';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as ST from '@effect/data/Struct';
import * as H from '@effect/data/Hash';
import * as HS from '@effect/data/HashSet';
import * as HM from '@effect/data/HashMap';
import * as P from '@effect/data/Predicate';
import * as E from '@effect/data/Either';
import * as O from '@effect/data/Option';
import { pipe } from '@effect/data/Function';

import { HashMap_every, Refinement_and, Refinement_struct } from '../utils/ShouldBeBuiltin';

import * as Conclusion from './Conclusion';

/**
 * Something that we know about a specific topic
 * Q - the topic that we know about
 * Conclusion - the conclusion we have about that topic
 */
export type ConclusionMap<Q, A> =
    EQ.Equal & {
        readonly conclusions: HM.HashMap<Q, Conclusion.Conclusion<A>>;
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
    );

export const isConclusionMap: P.Refinement<unknown, ConclusionMap<unknown, unknown>> =
    getRefinement(P.isUnknown, P.isUnknown);

export const Equivalence: EQV.Equivalence<ConclusionMap<unknown, unknown>> =
    ST.getEquivalence({
        conclusions: EQ.equivalence(),
    });

const create = <Q, A>(
    conclusions: HM.HashMap<Q, Conclusion.Conclusion<A>>
): ConclusionMap<Q, A> =>
    ({
        conclusions,

        toString() {
           return `${String(this.conclusions)}`;
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

// TODO don't just union thes. This overwrites old values. Instead, actually merge the conclusions and error on conflicts
export const combine = <Q, A>(first: ConclusionMap<Q, A>, second: ConclusionMap<Q, A>): ConclusionMap<Q, A> =>
    create(HM.union(first.conclusions, second.conclusions));

export const addOrSet = (
    collisionStrategy: 'overwrite' | 'fail',
) => <Q, A>(
    question: Q,
    answer: A,
    reason: Conclusion.Reason,
) => (
    { conclusions }: ConclusionMap<Q, A>,
): E.Either<string, ConclusionMap<Q, A>> =>
    E.gen(function* ($) {
        // Prepare our function to combine conclusions
        const combine = Conclusion.combine<A>(collisionStrategy);

        // Create the new conclusion
        const newConclusion = yield* $(Conclusion.create(answer, HS.fromIterable([reason])));

        // Create the conclusion to add
        const combinedConclusion = yield* $(
            // Get any existing conclusion
            HM.get(conclusions, question),

            O.match(
                // There is no existing conclusion, so just use the new one
                () => E.right(newConclusion),

                // Combine the new conclusion into the existing one
                combine(newConclusion),
            ),
        );

        // Insert the new conclusion
        return yield* $(E.right(
            create(
                HM.set(conclusions, question, combinedConclusion),
            ),
        ));
    });

export const add: <Q, A>(
    question: Q,
    answer: A,
    reason: Conclusion.Reason,
) => (
    { conclusions }: ConclusionMap<Q, A>,
) => E.Either<string, ConclusionMap<Q, A>> =
    addOrSet('fail');

export const set: <Q, A>(
    question: Q,
    answer: A,
    reason: Conclusion.Reason,
) => (
    { conclusions }: ConclusionMap<Q, A>,
) => E.Either<string, ConclusionMap<Q, A>> =
    addOrSet('overwrite');
