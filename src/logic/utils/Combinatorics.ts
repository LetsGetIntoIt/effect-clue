import { Context, Effect, Layer, pipe, Cache, Bigint, Match, Data } from "effect";
import { CacheStats } from "effect/Cache";

export interface Combinatorics {
    factorial: (n: number) => Effect.Effect<never, never, bigint>;
    binomial: (n: number, k: number) => Effect.Effect<never, never, bigint>;

    cacheStats: () => Effect.Effect<never, never, {
        factorial: CacheStats;
        binomial: CacheStats;
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

    return Combinatorics.of({
        factorial: (n) => cachedFactorial.get(n),
        binomial: (n, k) => cachedBinomial.get(Data.tuple(n, k)),

        cacheStats: () => Effect.all({
            factorial: cachedFactorial.cacheStats(),
            binomial: cachedBinomial.cacheStats(),
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
