import { constTrue, constant, flow, pipe } from '@effect/data/Function';
import { B, D, E, M, N, P, ROA, ST } from './utils/EffectImports';
import { Brand_refined, Either_fromPredicate, Either_validateNonEmpty, Struct_get } from './utils/Effect';
import { Either_validate } from './utils/Effect';

export interface RangeExact extends D.Case {
    _tag: "RangeExact";
    readonly value: number;
};

const RangeExact = D.tagged<RangeExact>("RangeExact");

type ValidatedRangeExact = RangeExact & B.Brand<'ValidatedRangeExact'>;

const ValidatedRangeExact = Brand_refined<ValidatedRangeExact>([
    // nothing to validate
]);

export interface RangeBounded extends D.Case {
    _tag: "RangeBounded";
    readonly min: number;
    readonly max: number;
};

const RangeBounded = D.tagged<RangeBounded>("RangeBounded");

type ValidatedRangeBounded = RangeBounded & B.Brand<'ValidatedRangeBounded'>;

const ValidatedRangeBounded = Brand_refined<ValidatedRangeBounded>([
    Either_fromPredicate(
        ({ min, max }) => min < max,
        constant(B.error(`min should be strictly less than max`)),
    ),
]);

export type Range = ValidatedRangeExact | ValidatedRangeBounded;

export const Range = (min: number, max?: number): E.Either<B.Brand.BrandErrors, Range> =>
    P.isNotNullable(max)
        ? min === max
            ? pipe(RangeExact({ value: min }), ValidatedRangeExact)
            : pipe(RangeBounded({ min, max }), ValidatedRangeBounded)
        : pipe(RangeExact({ value: min }), ValidatedRangeExact);

// TODO can this be baked in as a property of the objects themselves, so that its just directly available?
export const min: (range: Range) => number =
    pipe(
        M.type<Range>(),
        M.tag('RangeExact', ({ value }) => value),
        M.tag('RangeBounded', ({ min }) => min),
        M.exhaustive,
    );

// TODO can this be baked in as a property of the objects themselves, so that its just directly available?
export const max: (range: Range) => number =
    pipe(
        M.type<Range>(),
        M.tag('RangeExact', ({ value }) => value),
        M.tag('RangeBounded', ({ max }) => max),
        M.exhaustive,
    );

const narrowInternal = (newMin?: number, newMax?: number): ((range: Range) => E.Either<B.Brand.BrandErrors, Range>) =>
    flow(
        range => ({
            min: min(range),
            max: max(range),
        }),

        Either_validateNonEmpty([
            Either_fromPredicate(
                P.isNotNullable(newMin)
                    ? pipe(N.lessThanOrEqualTo(newMin), P.contramap(Struct_get('min')))
                    : constTrue,
                ({ min }) => B.error(`Cannot clamp existing min=${min} to newMin=${newMin}. min is already narrower (greater) than newMin`),
            ),

            Either_fromPredicate(
                P.isNotNullable(newMax)
                    ? pipe(N.greaterThanOrEqualTo(newMax), P.contramap(Struct_get('max')))
                    : constTrue,
                    ({ max }) => B.error(`Cannot clamp existing max=${max} to newMax=${newMax}. max is already narrower (less) than newMax`),
            ),
        ]),

        E.bimap(
            (errors) => B.errors(...errors),
            ROA.headNonEmpty,
        ),

        E.flatMap(({ min, max }) => Range(min, max)),
    );

export const narrowMin = (newMin: number): ((range: Range) => E.Either<B.Brand.BrandErrors, Range>) =>
    narrowInternal(newMin, undefined);

export const narrowMax = (newMax: number): ((range: Range) => E.Either<B.Brand.BrandErrors, Range>) =>
    narrowInternal(undefined, newMax);

export const narrow = (newMin: number, newMax: number): ((range: Range) => E.Either<B.Brand.BrandErrors, Range>) =>
    narrowInternal(newMin, newMax);
