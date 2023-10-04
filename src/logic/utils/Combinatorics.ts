import { Context, Effect, Layer, pipe, Cache, Bigint, Match, Data, HashSet, Hash } from "effect";
import { CacheStats } from "effect/Cache";

export interface Combinatorics {
    factorial: (n: number) => Effect.Effect<never, never, bigint>;
    binomial: (n: number, k: number) => Effect.Effect<never, never, bigint>;
    subsets: <A>(self: HashSet.HashSet<A>) => Effect.Effect<never, never, HashSet.HashSet<HashSet.HashSet<A>>>;

    cacheStats: () => Effect.Effect<never, never, {
        factorial: CacheStats;
        binomial: CacheStats;
        subsets: CacheStats;
    }>;
}

export const Combinatorics = Context.Tag<Combinatorics>();

export const combinatoricsLive: Layer.Layer<never, never, Combinatorics> = Layer.effect(Combinatorics, Effect.gen(function* ($) {
    const cachedFactorial: Cache.Cache<number, never, bigint> = yield* $(Cache.make({
        capacity: Number.MAX_SAFE_INTEGER,
        timeToLive: Infinity,
        lookup: (n: number) => factorial(n, cachedFactorial),
    }));

    const cachedBinomial = yield* $(Cache.make({
        capacity: Number.MAX_SAFE_INTEGER,
        timeToLive: Infinity,
        lookup: ([n, k]: Data.Data<[number, number]>) => binomial(n, k, cachedFactorial),
    }));

    const cachedSubsets = yield* $(Cache.make({
        capacity: Number.MAX_SAFE_INTEGER,
        timeToLive: Infinity,
        lookup: (set: HashSet.HashSet<unknown>) => Effect.sync(() => subsets(set)),
    }));

    return Combinatorics.of({
        factorial: (n) => cachedFactorial.get(n),
        binomial: (n, k) => cachedBinomial.get(Data.tuple(n, k)),
        subsets: <A>(set: HashSet.HashSet<A>) => cachedSubsets.get(set) as Effect.Effect<never, never, HashSet.HashSet<HashSet.HashSet<A>>>,

        cacheStats: () => Effect.all({
            factorial: cachedFactorial.cacheStats(),
            binomial: cachedBinomial.cacheStats(),
            subsets: cachedSubsets.cacheStats(),
        }),
    });
}));

const binomial = (n: number, k: number, factorial: Cache.Cache<number, never, bigint>): Effect.Effect<never, never, bigint> =>
    pipe(
        Effect.all({
            n: factorial.get(n),
            nk: factorial.get(n - k),
            k: factorial.get(k),
        }),

        Effect.map(({ n, nk, k }) => n / (nk * k)),
    );

const factorial = (n: number, factorial: Cache.Cache<number, never, bigint>): Effect.Effect<never, never, bigint> =>
    n <=1
        ? Effect.succeed(1n)
        : factorial.get(n - 1).pipe(
            Effect.map(Bigint.multiply(BigInt(n))),
        );

export const subsets = <A>(hashSet: HashSet.HashSet<A>): HashSet.HashSet<HashSet.HashSet<A>> =>
    // TODO can make this maybe more performant by using recursion (which will maybe put more in the cache)
    HashSet.reduce(
        hashSet,
        HashSet.make(HashSet.empty<A>()),
        (subsets, nextElement) => HashSet.union(
            subsets,
            HashSet.map(subsets, HashSet.add(nextElement)),
        ),
    );
