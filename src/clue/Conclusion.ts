import { D, HS, B, EQV, ST, EQ, E, BOOL, M } from '../utils/EffectImports';
import { pipe, constant } from '@effect/data/Function';
import { Brand_refined, Equivalence_constTrue } from '../utils/ShouldBeBuiltin';

export interface Reason extends D.Case {
    _tag: "Reason";
    readonly level: 'observed' | 'inferred';
    readonly explanation: string;
};

export const Reason = D.tagged<Reason>("Reason");

export interface Conclusion<A> extends D.Case {
    _tag: "Conclusion";
    readonly answer: A,
    readonly reasons: HS.HashSet<Reason>;
};

export const ConclusionOf = <A>() => D.tagged<Conclusion<A>>("Conclusion");

export type ValidatedConclusion<A> = Conclusion<A> & B.Brand<'ValidatedConclusion'>;

export const ValidatedConclusionOf = <A>() => Brand_refined<ValidatedConclusion<A>>([
    // TODO validate this in any way?
]);

const EquivalenceIgnoreReasons: EQV.Equivalence<ValidatedConclusion<unknown>> =
    ST.getEquivalence({
        answer: EQ.equivalence(),

        // Ignore whether the reasons are equivalent or not
        reasons: Equivalence_constTrue,
    });

export const combine = <A>(
    collisionStrategy: 'overwrite' | 'fail',
) => (
    newConclusion: ValidatedConclusion<A>,
) => (
    oldConclusion: ValidatedConclusion<A>,
// TODO don't mix brand errors with logical paradox errors
): E.Either<B.Brand.BrandErrors, ValidatedConclusion<A>> =>
    pipe(
        EquivalenceIgnoreReasons(newConclusion, oldConclusion),

        BOOL.match(
            // The values are not equal
            constant(pipe(
                M.value(collisionStrategy),

                // If the strategy is to overwrite, just use the new conclusion
                M.when('overwrite',  () => E.right(newConclusion)),

                // If the strategy is to fail, do so
                M.when('fail', () => E.left(B.error(`New conclusion ${newConclusion} conflicts with existing conclusion ${oldConclusion}`))),

                M.exhaustive,
            )),

            // The values are equal, so just merge the reasons
            () => pipe(
                {
                    answer: newConclusion.answer,
                    reasons: HS.union(newConclusion.reasons, oldConclusion.reasons),
                },

                ConclusionOf(),
                ValidatedConclusionOf(),
            ),
        ),
    );
