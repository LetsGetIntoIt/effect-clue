import { B, HM, E, HS, O, T } from '../../utils/effect/EffectImports';
import { pipe } from '@effect/data/Function';
import { Brand_refined } from '../../utils/effect/Effect';

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
        T.runSync,
    );

export const setMergeOrOverwriteOrFail = (
    collisionStrategy: 'overwrite' | 'fail',
) => <Q, A>(
    question: Q,
    answer: A,
    reasons: HS.HashSet<Conclusion.Reason>,
) => (
    deductions: ValidatedConclusionMap<Q, A>,
) : T.Effect<never, B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =>
    T.gen(function* ($) {
        // Prepare our function to combine deductions
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
            HM.get(deductions, question),

            O.match({
                // There is no existing conclusion, so just use the new one
                onNone: () => E.right(newConclusion),

                // Combine the new conclusion into the existing one
                onSome: combine(newConclusion),
            }),
        );

        // Insert the new conclusion
        return yield* $(
            HM.set(deductions, question, combinedConclusion),
            ConclusionMapOf(),
            ValidatedConclusionMapOf(),
        );
    });

export const setMergeOrFail: <Q, A>(
    question: Q,
    answer: A,
    reasons: HS.HashSet<Conclusion.Reason>,
) => (
    deductions: ValidatedConclusionMap<Q, A>,
) => T.Effect<never, B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =
    setMergeOrOverwriteOrFail('fail');

export const setMergeOrOverwrite: <Q, A>(
    question: Q,
    answer: A,
    reasons: HS.HashSet<Conclusion.Reason>,
) => (
    deductions: ValidatedConclusionMap<Q, A>,
) => T.Effect<never, B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =
    setMergeOrOverwriteOrFail('overwrite');

export const combineMergeOrOverwriteOrFail = (
    collisionStrategy: 'overwrite' | 'fail',
) => <Q, A>(
    second: ValidatedConclusionMap<Q, A>,
) => (
    first: ValidatedConclusionMap<Q, A>,
): T.Effect<never, B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =>
        HM.reduceWithIndex<
            T.Effect<never, B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>>,
            Conclusion.Conclusion<A>,
            Q
        >(
            second,

            T.succeed(first),

            (combinedEither, { answer, reasons }, question) => pipe(
                combinedEither,

                T.flatMap(
                    setMergeOrOverwriteOrFail(collisionStrategy)(question, answer, reasons),
                ),
            ),
        );

export const combineMergeOrFail: <Q, A>(
    second: ValidatedConclusionMap<Q, A>,
) => (
    deductions: ValidatedConclusionMap<Q, A>,
) => T.Effect<never, B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =
    combineMergeOrOverwriteOrFail('fail');

export const combineMergeOrOverwrite: <Q, A>(
    second: ValidatedConclusionMap<Q, A>,
) => (
    deductions: ValidatedConclusionMap<Q, A>,
) => T.Effect<never, B.Brand.BrandErrors, ValidatedConclusionMap<Q, A>> =
    combineMergeOrOverwriteOrFail('overwrite');
