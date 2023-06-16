import * as E from '@effect/data/Either';
import * as HS from '@effect/data/HashSet';
import * as HM from '@effect/data/HashMap';
import * as O from '@effect/data/Option';
import * as ROA from '@effect/data/ReadonlyArray';
import * as SG from '@effect/data/typeclass/Semigroup'
import * as MN from '@effect/data/typeclass/Monoid'
import * as EQ from '@effect/data/Equal';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as P from '@effect/data/Predicate';
import * as TU from '@effect/data/Tuple';
import * as BOOL from '@effect/data/Boolean';
import * as T from '@effect/io/Effect';
import * as B from '@effect/data/Brand';
import { pipe, identity, flow, constTrue, apply } from '@effect/data/Function'

export const Option_fromRefinement = <A, B extends A>(refinement: P.Refinement<A, B>) => (a: A): O.Option<B> =>
    pipe(
        refinement(a),

        BOOL.match(
            // The value doesn't pass the refinement
            () => O.none(),

            () => O.some(a as B),
        ),
    );

export const Option_fromPredicate: <A>(predicate: P.Predicate<A>) => (a: A) => O.Option<A> =
    Option_fromRefinement as any;

export type Endomorphism<A> = (a: A) => A

export const Endomorphism_getMonoid = <A>(): MN.Monoid<Endomorphism<A>> =>
  MN.fromSemigroup(
    SG.make((f, g) => flow(f, g)),
    identity
  );

export const HashSet_of = <A>(value: A): HS.HashSet<A> =>
    HS.fromIterable([value]);

export const HashSet_fromHashMapMulti = <K, V>(hashMap: HM.HashMap<K, HS.HashSet<V>>): HS.HashSet<[K, V]> =>
    pipe(
        hashMap,

        HM.mapWithIndex((hashSet, key) =>
            HS.map(hashSet, (value) =>
                TU.tuple(key, value),
            ),
        ),

        HM.values,

        ROA.reduce(
            HS.empty<[K, V]>(),
            (unionSet, nextSet) => HS.union(unionSet, nextSet),
        ),
    );

export const Effect_getSemigroupCombine = <A, E, R>(combine: (a: A, b: A) => T.Effect<R, E, A>): SG.Semigroup<T.Effect<R, E, A>> =>
    SG.make((first, second) => T.gen(function* ($) {
        const firstValue = yield* $(first);
        const secondValue = yield* $(second);

        return yield* $(combine(firstValue, secondValue));
    }));

export const HashSet_isSize = <A>(size: number): P.Predicate<HS.HashSet<A>> =>
    (hashSet) =>
        HS.size(hashSet) === size;

export const Struct_get = <S, Key extends keyof S>(
    key: Key,
) => (
    s: S,
): S[Key] =>
    s[key];

export const Either_swap: <E, A>(either: E.Either<E, A>) => E.Either<A, E> =
    E.match(E.right, E.left);

export const Brand_refined = <Branded extends B.Brand<string | symbol>>(
    refinements: readonly ((unbranded: B.Brand.Unbranded<Branded>) => O.Option<B.Brand.BrandErrors>)[],
) => (
    unbranded: B.Brand.Unbranded<Branded>
): E.Either<B.Brand.BrandErrors, Branded> =>
    pipe(
        refinements,
        ROA.map(apply(unbranded)),

        ROA.sequence(O.Applicative),

        O.map(errors => B.errors(...errors)),

        E.fromOption(() => unbranded),
        Either_swap,
        E.map(B.nominal<Branded>()),
    );

export const Brand_refinedEffect = <Branded extends B.Brand<string | symbol>, R>(
    refinements: T.Effect<R, never, readonly ((unbranded: B.Brand.Unbranded<Branded>) => O.Option<B.Brand.BrandErrors>)[]>,
) => (
    unbranded: B.Brand.Unbranded<Branded>
): T.Effect<R, B.Brand.BrandErrors, Branded> =>
    pipe(
        refinements,

        T.flatMap(refinements =>
            Brand_refined(refinements)(unbranded),
        ),
    );

export const HashMap_setOrUpdate = <K, V>(
    key: K,
    set: () => V,
    update: (existing: V) => V,
) => (
    hashMap: HM.HashMap<K, V>
): HM.HashMap<K, V> =>
    pipe(
        // See if there's a value
        HM.get(hashMap, key),

        // Decide the updated value to set
        O.match(set, update),

        updatedValue => HM.set(hashMap, key, updatedValue),
    );
