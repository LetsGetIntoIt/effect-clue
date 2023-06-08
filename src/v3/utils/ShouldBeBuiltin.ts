import * as E from '@effect/data/Either';
import * as ROA from '@effect/data/ReadonlyArray';

// TODO replace this with some in-built util that does the same thing
export const combineApply = <I>(fns: readonly ((i: I) => I)[]) => (initial: I): I =>
    ROA.reduce(fns, initial, (current, mapper) => mapper(current));

// TODO replace this with some in-built util that does the same thing
export const eitherApply = <E, A>(maybeFn: E.Either<E, (a: A) => A>): ((a: A) => E.Either<E, A>) =>
    null;
