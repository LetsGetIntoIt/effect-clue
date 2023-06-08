import * as E from '@effect/data/Either';
import * as HS from '@effect/data/HashSet';
import { identity, flow } from '@effect/data/Function'
import * as SG from '@effect/data/typeclass/Semigroup'
import * as MN from '@effect/data/typeclass/Monoid'
import * as EQV from '@effect/data/typeclass/Equivalence';

export type Endomorphism<A> = (a: A) => A

export const Endomorphism_getMonoid = <A>(): MN.Monoid<Endomorphism<A>> =>
  MN.fromSemigroup(
    SG.make((f, g) => flow(f, g)),
    identity
  );

// TODO replace this with some in-built util that does the same thing
export const eitherApply = <E, A>(maybeFn: E.Either<E, (a: A) => A>): ((a: A) => E.Either<E, A>) =>
    null;

// TODO replace this with some in-built util that does the same thing
export const HashSet_getEquivalence = <A>(EQVA: EQV.Equivalence<A>): EQV.Equivalence<HS.HashSet<A>> =>
    null;
