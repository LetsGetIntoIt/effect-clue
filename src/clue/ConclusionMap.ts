import { B, HM, E, HS, O } from '../utils/EffectImports';
import { pipe } from '@effect/data/Function';
import { Brand_refined } from '../utils/ShouldBeBuiltin';

import * as Conclusion from './Conclusion';

export type ConclusionMap<Q, A> = B.Branded<HM.HashMap<Q, Conclusion.ValidatedConclusion<A>>, 'ConclusionMap'>;

export const ConclusionMapOf = <Q, A>() => B.nominal<ConclusionMap<Q, A>>();

export type ValidatedConclusionMap<Q, A> = ConclusionMap<Q, A> & B.Brand<'ValidatedConclusionMap'>;

export const ValidatedConclusionMapOf = <Q, A>() => Brand_refined<ValidatedConclusionMap<Q, A>>([
    // TODO validate this in any way?
]);

export const empty = <Q, A>(): ValidatedConclusionMap<Q, A> =>
    pipe(
        HM.empty<Q, Conclusion.ValidatedConclusion<A>>(),
        ConclusionMapOf(),
        ValidatedConclusionMapOf(),
        E.getOrThrow,
    );

export const setMergeOrOverwriteOrFail = (
    collisionStrategy: 'overwrite' | 'fail',
) => <Q, A>(
    question: Q,
    answer: A,
    reasons: HS.HashSet<Conclusion.Reason>,
) => (
    conclusions: ValidatedConclusionMap<Q, A>,
) : E.Either<B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =>
    E.gen(function* ($) {
        // Prepare our function to combine conclusions
        const combine = Conclusion.combine<A>(collisionStrategy);

        // Create the new conclusion
        const newConclusion = yield* $(
            { answer, reasons, },
            Conclusion.ConclusionOf(),
            Conclusion.ValidatedConclusionOf(),
        );

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
        return yield* $(
            HM.set(conclusions, question, combinedConclusion),
            ConclusionMapOf(),
            ValidatedConclusionMapOf(),
        );
    });

export const setMergeOrFail: <Q, A>(
    question: Q,
    answer: A,
    reasons: HS.HashSet<Conclusion.Reason>,
) => (
    conclusions: ValidatedConclusionMap<Q, A>,
) => E.Either<B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =
    setMergeOrOverwriteOrFail('fail');

export const setMergeOrOverwrite: <Q, A>(
    question: Q,
    answer: A,
    reasons: HS.HashSet<Conclusion.Reason>,
) => (
    conclusions: ValidatedConclusionMap<Q, A>,
) => E.Either<B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =
    setMergeOrOverwriteOrFail('overwrite');

export const combineMergeOrOverwriteOrFail = (
    collisionStrategy: 'overwrite' | 'fail',
) => <Q, A>(
    second: ValidatedConclusionMap<Q, A>,
) => (
    first: ValidatedConclusionMap<Q, A>,
): E.Either<B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =>
        HM.reduceWithIndex<
            E.Either<B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>>,
            Conclusion.Conclusion<A>,
            Q
        >(
            second,

            E.right(first),

            (combinedEither, { answer, reasons }, question) => pipe(
                combinedEither,

                E.flatMap(
                    setMergeOrOverwriteOrFail(collisionStrategy)(question, answer, reasons),
                ),
            ),
        );

export const combineMergeOrFail: <Q, A>(
    second: ValidatedConclusionMap<Q, A>,
) => (
    conclusions: ValidatedConclusionMap<Q, A>,
) => E.Either<B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =
    combineMergeOrOverwriteOrFail('fail');

export const combineMergeOrOverwrite: <Q, A>(
    second: ValidatedConclusionMap<Q, A>,
) => (
    conclusions: ValidatedConclusionMap<Q, A>,
) => E.Either<B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =
    combineMergeOrOverwriteOrFail('overwrite');
