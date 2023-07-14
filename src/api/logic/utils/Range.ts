import { compose, constTrue, pipe } from '@effect/data/Function';
import { B, E, N, O, P, PR, ROA, S, T, TU } from '../../utils/effect/EffectImports';
import { Either_fromPredicate, Either_validateNonEmpty } from '../../utils/effect/Effect';

export const Schema = pipe(
    S.tuple(S.number, S.optionFromNullable(S.number)),

    // Default the max to equal the min, and make sure they are in the right order
    S.transformResult(
        S.tuple(S.number, S.number),

        ([min, max]) => O.match(max, {
            onNone: () => PR.success(TU.tuple(min, min)),

            onSome: (max) => min <= max
                ? PR.success(TU.tuple(min, max))
                : PR.failure(PR.unexpected([min, max])) // TODO use a good error message
        }),

        ([min, max]) => PR.success(TU.tuple(min, O.some(max))),
    ),

    // Provide Brand and Equal implementation
    S.brand('Range'),
    S.data,
);

export type SerializedRange = S.From<typeof Schema>;
export type Range = S.To<typeof Schema>;

export const decodeEither = S.decodeEither(Schema);
export const decodeSync = S.decodeSync(Schema);

export const exact = (n: number): Range => decodeSync([n, null], { errors: 'all' });
export const bounded = (min: number, max: number): E.Either<PR.ParseError, Range> => decodeEither([min, max], { errors: 'all' });
export const boundedSync = (min: number, max: number): Range => decodeSync([min, max], { errors: 'all' });

export const is = S.is(Schema);

export const getMin = (range: Range): number => TU.getFirst(range);
export const getMax = (range: Range): number => TU.getSecond(range);

const narrowInternal = (newMin?: number, newMax?: number) => (range: Range): T.Effect<never, PR.ParseError | B.Brand.BrandErrors, Range> =>
    pipe(
        range,

        Either_validateNonEmpty([
            Either_fromPredicate(
                P.isNotNullable(newMin)
                    ? pipe(N.lessThanOrEqualTo(newMin), P.mapInput(getMin))
                    : constTrue,
                ([min]) => B.error(`Cannot clamp existing min=${min} to newMin=${newMin}. min is already narrower (greater) than newMin`),
            ),

            Either_fromPredicate(
                P.isNotNullable(newMax)
                    ? pipe(N.greaterThanOrEqualTo(newMax), P.mapInput(getMax))
                    : constTrue,
                    ([, max]) => B.error(`Cannot clamp existing max=${max} to newMax=${newMax}. max is already narrower (less) than newMax`),
            ),
        ]),

        E.mapBoth({
            onLeft: (errors) => B.errors(...errors),
            onRight: ROA.headNonEmpty,
        }),

        T.flatMap(S.decodeEither(Schema)),
    );

export const narrowMin = (newMin: number): ((range: Range) => T.Effect<never, PR.ParseError | B.Brand.BrandErrors, Range>) =>
    narrowInternal(newMin, undefined);

export const narrowMax = (newMax: number): ((range: Range) => T.Effect<never, PR.ParseError | B.Brand.BrandErrors, Range>) =>
    narrowInternal(undefined, newMax);

export const narrow = (newMin: number, newMax: number): ((range: Range) => T.Effect<never, PR.ParseError | B.Brand.BrandErrors, Range>) =>
    narrowInternal(newMin, newMax);
