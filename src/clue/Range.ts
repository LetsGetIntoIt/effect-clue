import { pipe } from '@effect/data/Function';
import { D, M, P } from '../utils/EffectImports';

export interface RangeExact extends D.Case {
    _tag: "RangeExact";
    readonly value: number;
};

const RangeExact = D.tagged<RangeExact>("RangeExact");

export interface RangeBounded extends D.Case {
    _tag: "RangeBounded";
    readonly min: number;
    readonly max: number;
};

const RangeBounded = D.tagged<RangeBounded>("RangeBounded");

export type Range = RangeExact | RangeBounded;

export const Range = (min: number, max?: number): Range =>
    P.isNotNullable(max)
        ? min === max
            ? RangeExact({ value: min })
            : RangeBounded({ min, max })
        : RangeExact({ value: min });

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
