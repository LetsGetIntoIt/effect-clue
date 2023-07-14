import { D, HS, B, EQV, ST, EQ, E, BOOL, M, ROA } from '../../utils/effect/EffectImports';
import { pipe } from '@effect/data/Function';
import { Equivalence_constTrue } from '../../utils/effect/Effect';

export interface Reason extends D.Case {
    _tag: "Reason";
    readonly level: 'observed' | 'inferred';
    readonly explanation: string;
};

export const Reason = D.tagged<Reason>("Reason");

export const ReasonObserved = (explanation: string): Reason =>
    Reason({
        level: 'observed',
        explanation,
    });

export const ReasonInferred = (explanation: string): Reason =>
    Reason({
        level: 'inferred',
        explanation,
    });

export interface Conclusion<A> extends D.Case {
    _tag: "Conclusion";
    readonly answer: A,
    readonly reasons: HS.HashSet<Reason>;
};

const ConclusionOf = <A>() => D.tagged<Conclusion<A>>("Conclusion");

// TODO validate that there is at least 1 reason
export const of = <A>(answer: A, reasons: HS.HashSet<Reason>): Conclusion<A> =>
    ConclusionOf<A>()({
        answer,
        reasons,
    });

const EquivalenceIgnoreReasons: EQV.Equivalence<Conclusion<unknown>> =
    ST.getEquivalence({
        answer: EQ.equivalence(),

        // Ignore whether the reasons are equivalent or not
        reasons: Equivalence_constTrue,
    });

export const combine = <A>(
    collisionStrategy: 'overwrite' | 'fail',
) => (
    newConclusion: Conclusion<A>,
) => (
    oldConclusion: Conclusion<A>,
    // TODO don't mix brand errors with logical paradox errors
): E.Either<B.Brand.BrandErrors, Conclusion<A>> =>
    pipe(
        EquivalenceIgnoreReasons(newConclusion, oldConclusion),

        BOOL.match({
            // The values are not equal
            onFalse: () => pipe(
                M.value(collisionStrategy),

                // If the strategy is to overwrite, just use the new conclusion
                M.when('overwrite',  () => E.right(newConclusion)),

                // If the strategy is to fail, do so
                M.when('fail', () => E.left(B.error(`New conclusion ${newConclusion} conflicts with existing conclusion ${oldConclusion}`))),

                M.exhaustive,
            ),

            // The values are equal, so just merge the reasons
            onTrue: () => E.right(
                ConclusionOf<A>()({
                    answer: newConclusion.answer,
                    reasons: HS.union(newConclusion.reasons, oldConclusion.reasons),
                }),
            ),
        }),
    );
