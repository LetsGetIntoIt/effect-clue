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
import { pipe, identity, flow, constant, constTrue } from '@effect/data/Function'

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

// TODO replace this with some in-built util that does the same thing
export const eitherApply = <E, A>(maybeFn: E.Either<E, (a: A) => A>): ((a: A) => E.Either<E, A>) =>
    null;

export const HashSet_every = <A, B extends A>(refineValue: P.Refinement<A, B>): P.Refinement<HS.HashSet<A>, HS.HashSet<B>> =>
    (hashSet): hashSet is HS.HashSet<B> =>
        HS.every(hashSet, refineValue);

export const HashMap_every = <AIn, BIn, AOut extends AIn, BOut extends BIn>(refineKey: P.Refinement<AIn, AOut>, refineValue: P.Refinement<BIn, BOut>): P.Refinement<HM.HashMap<AIn, BIn>, HM.HashMap<AOut, BOut>> =>
    (hashMap): hashMap is HM.HashMap<AOut, BOut> =>
        HS.every(HM.keySet(hashMap), refineKey)
        && pipe(HM.values(hashMap), ROA.fromIterable, ROA.every(refineValue));

export const HashSet_getEquivalence = <A>(EQVA: EQV.Equivalence<A>): EQV.Equivalence<HS.HashSet<A>> =>
    null;

export const HashMap_getEquivalence = <A, B>(EQVA: EQV.Equivalence<A>, EQVB: EQV.Equivalence<B>): EQV.Equivalence<HM.HashMap<A, B>> =>
    null;

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

export const Refinement_struct =
    <R extends Record<string | number | symbol, unknown>>(refinements: { [k in keyof R]: P.Refinement<unknown, R[k]>}):
    P.Refinement<unknown, R> =>
        pipe(
            P.isRecord,

            P.compose((obj): obj is R => {
                // TODO
            }),
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

export declare const Show_symbol: unique symbol;

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

export const Show_showOption: <A extends Show>(option: O.Option<A>) => string =
    O.match(
        constant('None'),
        flow(Show_show, String_surroundWith('Some(', ')')),
    );

export const Show_showHashSet: (hashSet: HS.HashSet<unknown>) => string =
    flow(
        // Convert the values to an array
        HS.values,
        ROA.fromIterable, // TODO ROA.map should be able to handle iterables

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
        ROA.fromIterable, // TODO ROA.map should be able to handle iterables

        // Show each key -> value mapping
        ROA.map(flow(
            TU.bimap(Show_show, Show_show),
            ROA.join(' -> '),
        )),

        // Concatenate it all into one string
        ROA.join(", "),
        String_surroundWith('{ ', ' }'),
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

export const Equivalence_constTrue: EQV.Equivalence<unknown> =
    EQV.make(constTrue);

export const Equals_getRefinement1 = <A extends EQ.Equal, const M extends A>(model: M): P.Refinement<A, M> =>
    (a): a is M =>
        // TODO is there a function that avoids this manual EQ.symbol?
        model[EQ.symbol](a);

export const Equals_getRefinement2 = <A, const M extends A>(model: M, eqvA: EQV.Equivalence<A>): P.Refinement<A, M> =>
    (a): a is M =>
        // TODO is there a function that avoids this manual EQ.symbol?
        eqvA(model, a);

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
