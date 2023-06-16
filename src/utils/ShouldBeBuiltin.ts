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
import * as B from '@effect/data/Boolean';
import * as T from '@effect/io/Effect';
import * as ST from '@effect/data/Struct';
import { pipe, identity, flow, constant, constTrue } from '@effect/data/Function'

export const Equivalence_contramap = <A, B>(
    contramap: (b: B) => A,
) => (
    EQA: EQV.Equivalence<A>,
): EQV.Equivalence<B> =>
    EQV.make(
        (self, that) => EQA(
            contramap(self),
            contramap(that),
        ),
    );

export const Either_fromRefinement = <A, B extends A>(refinement: P.Refinement<A, B>) => (a: A): E.Either<Exclude<A, B>, B> =>
    pipe(
        refinement(a),

        B.match(
            // The value doesn't pass the refinement
            () => E.left(a as Exclude<A, B>),

            () => E.right(a as B),
        ),
    );

export const String_surroundWith = (pre: string, post = pre) => (str: string): string =>
    `${pre}${str}${post}`;

export type Endomorphism<A> = (a: A) => A

export const Endomorphism_getMonoid = <A>(): MN.Monoid<Endomorphism<A>> =>
  MN.fromSemigroup(
    SG.make((f, g) => flow(f, g)),
    identity
  );

export const HashSet_fromOption = <A>(val: O.Option<A>): HS.HashSet<A> =>
    O.match(
        val,
        HS.empty<A>,
        flow(ROA.of, HS.fromIterable),
    );

export const HashSet_every = <A, B extends A>(refineValue: P.Refinement<A, B>): P.Refinement<HS.HashSet<A>, HS.HashSet<B>> =>
    (hashSet): hashSet is HS.HashSet<B> =>
        HS.every(hashSet, refineValue);

export const HashMap_every = <AIn, BIn, AOut extends AIn, BOut extends BIn>(refineKey: P.Refinement<AIn, AOut>, refineValue: P.Refinement<BIn, BOut>): P.Refinement<HM.HashMap<AIn, BIn>, HM.HashMap<AOut, BOut>> =>
    (hashMap): hashMap is HM.HashMap<AOut, BOut> =>
        pipe(hashMap, HM.keySet, HS.every(refineKey))
        && pipe(hashMap, HM.values, ROA.fromIterable, ROA.every(refineValue));

export const HashMap_entries = <K, V>(hashMap: HM.HashMap<K, V>): IterableIterator<[K, V]> =>
    pipe(
        HM.mapWithIndex(hashMap, (v, k) => TU.tuple(k, v)),
        HM.values,
    );

export const HashMap_setOrFail = <K, V>(key: K, value: V) => (map: HM.HashMap<K, V>): E.Either<V, HM.HashMap<K, V>> =>
    pipe(
        // Try getting the existing value
        HM.get(map, key),

        O.match(
            // The value doesn't already exist, so set it
            () => E.right(HM.set(map, key, value)),

            // The value already exists, so fail
            E.left,
        ),
    );

export const Refinement_as = <B>(): P.Refinement<unknown, B> =>
    (_): _ is B => true;

export const Refinement_has = <K extends string | number | symbol>(prop: K): P.Refinement<unknown, { [k in K]: unknown }> =>
    pipe(
        P.isObject,

        P.compose(
            (thing): thing is { [k in K]: unknown } =>
                prop in thing,
        ),
    );

export const Refinement_struct = <R extends Record<string, P.Refinement<unknown, unknown>>>(
    refinements: R,
): P.Refinement<
    unknown,
    {
        readonly [K in keyof R]: [R[K]] extends [P.Refinement<any, infer B>] ? B : never;
    }
> => pipe(
    P.isRecord,
    P.compose(P.struct(refinements) as any),
);

// Merged in this PR: https://github.com/Effect-TS/data/pull/361
export const Refinement_and:
        <A, C extends A>(that: P.Refinement<A, C>) =>
        <B extends A>(self: P.Refinement<A, B>) =>
        P.Refinement<A, B & C> =
    P.and as any;

export const Refinement_or:
    <A, C extends A>(that: P.Refinement<A, C>) =>
    <B extends A>(self: P.Refinement<A, B>) =>
    P.Refinement<A, B | C> =
        P.or as any;

export const Show_symbol: unique symbol = Symbol.for('Show');

export interface Show {
    [Show_symbol](): string;
}

export const Show_isShow: P.Refinement<unknown, Show> =
    Refinement_struct({
        [Show_symbol]: pipe(
            P.isNotNullable,
            Refinement_and(P.isFunction),

            // We can't verify the function arguments and return type,
            // so just cast it
            Refinement_and(Refinement_as<Show[typeof Show_symbol]>()),
        ),
    });

export const Show_show: (thing: unknown) => string =
    flow(
        Either_fromRefinement(Show_isShow),

        E.match(
            JSON.stringify,
            showable => showable[Show_symbol](),
        ),
    );

export const Show_showOption: (option: O.Option<unknown>) => string =
    O.match(
        constant('None'),
        flow(Show_show, String_surroundWith('Some(', ')')),
    );

export const Show_showHashSet: (hashSet: HS.HashSet<unknown>) => string =
    flow(
        // Convert the values to an array
        HS.values,
        ROA.fromIterable,

        // Show each element
        ROA.map(Show_show),

        // Concatenate it all into one string
        ROA.join(", "),
        String_surroundWith('{ ', ' }'),
    );

export const Show_showHashMap: (hashMap: HM.HashMap<unknown, unknown>) => string =
    flow(
        // Convert the values to an array
        HashMap_entries,
        ROA.fromIterable,

        // Show each key -> value mapping
        ROA.map(flow(
            TU.bimap(Show_show, Show_show),
            ROA.join(' -> '),
        )),

        // Concatenate it all into one string
        ROA.join(", "),
        String_surroundWith('{ ', ' }'),
    );

export const HashMap_fromHashSetTuple: <K, V>(hashSet: HS.HashSet<[K, V]>) => HM.HashMap<K, V> =
    flow(
        HS.values,
        HM.fromIterable,
    );

export const HashMap_fromHashSetMap = <K, V>(f: (k: K) => V): ((hashSet: HS.HashSet<K>) => HM.HashMap<K, V>) =>
    flow(
        HS.map(k => TU.tuple(k, f(k))),
        HashMap_fromHashSetTuple,
    );

export const HashMap_fromHashSetIdentity: <A>(hashSet: HS.HashSet<A>) => HM.HashMap<A, A> =
    HashMap_fromHashSetMap(identity);

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

export const HashSet_fromHashMap: <K, V>(hashMap: HM.HashMap<K, V>) => HS.HashSet<[K, V]> =
    flow(
        HM.map(HashSet_of),
        HashSet_fromHashMapMulti,
    );

export const HashMap_separateV = <V>(valuePredicate: P.Predicate<V>) => <K>(map: HM.HashMap<K, V>): [falseMap: HM.HashMap<K, V>, trueMap: HM.HashMap<K, V>] =>
    [
        // False map
        pipe(
            map,
            HM.filter(P.not(valuePredicate)),
        ),

        // True map
        pipe(
            map,
            HM.filter(valuePredicate),
        ),
    ];

export const HashMap_someWithIndex = <K, V>(
    predicate: (value: V, key: K) => boolean,
): ((hashMap: HM.HashMap<K, V>) => boolean) =>
    flow(
        HM.filterWithIndex(predicate),
        P.not(HM.isEmpty),
    );

export const Equivalence_constTrue: EQV.Equivalence<unknown> =
    EQV.make(constTrue);

export const Equals_getRefinement = <const A, const M extends A>(model: M): P.Refinement<A, M> =>
    (a): a is M =>
        EQ.equals(model)(a);

export const Option_getRefinement = <A, B extends A>(refinement: P.Refinement<A, B>): P.Refinement<O.Option<A>, O.Option<B>> =>
    (opt): opt is O.Option<B> =>
        O.match(
            opt,

            // If it's a none, we're done!
            constTrue,

            // If it's a some, refine the value
            refinement,
        );

export const Function_getSemigroup =
    <B>(SGB: SG.Semigroup<B>) =>
    <A = never>(): SG.Semigroup<(a: A) => B> =>
    SG.make(
        (f, g) => (a) => SGB.combine(f(a), g(a))
    );

export const Tuple_isLength = <T extends readonly unknown[]>(length: T["length"]): P.Refinement<readonly unknown[], T> =>
    (arr): arr is T => arr.length === length;

export const Tuple_getRefinement = <A extends readonly unknown[], B extends A>(
    refinements: {
        [K in keyof A]: P.Refinement<A[K], B[K]>
    }
): P.Refinement<A, B> =>
    (value: A): value is B =>
        value.every((value, index) =>
            refinements?.[index]?.(value as A[number])) as boolean;

export const ReadonlyArray_isArray: P.Refinement<unknown, unknown[]> =
    Array.isArray;

export const Either_getSemigroupCombine = <A, E>(combine: (a: A, b: A) => E.Either<E, A>): SG.Semigroup<E.Either<E, A>> =>
    SG.make((first, second) => E.gen(function* ($) {
        const firstValue = yield* $(first);
        const secondValue = yield* $(second);

        return yield* $(combine(firstValue, secondValue));
    }));

export const Effect_getSemigroupCombine = <A, E, R>(combine: (a: A, b: A) => T.Effect<R, E, A>): SG.Semigroup<T.Effect<R, E, A>> =>
    SG.make((first, second) => T.gen(function* ($) {
        const firstValue = yield* $(first);
        const secondValue = yield* $(second);

        return yield* $(combine(firstValue, secondValue));
    }));

export const Refinement_isTrue: P.Refinement<unknown, true> =
    (u): u is true =>
        u === true;

export const Refinement_isFalse: P.Refinement<unknown, false> =
    (u): u is false =>
        u === false;

export const Refinement_constTrue = <A>(): P.Refinement<A, A> =>
    constTrue as any;

export const HashSet_isSize = <A>(size: number): P.Predicate<HS.HashSet<A>> =>
    (hashSet) =>
        HS.size(hashSet) === size;

export const HashSet_isEmpty = <A>(): P.Predicate<HS.HashSet<A>> =>
    HashSet_isSize(0);

export const Struct_get = <S, Key extends keyof S>(
    key: Key,
) => (
    s: S,
): S[Key] =>
    s[key];
