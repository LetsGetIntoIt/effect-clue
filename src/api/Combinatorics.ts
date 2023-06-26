import { D, B, P, N, E, EQ } from '../utils/EffectImports';
import { constant, flow, pipe, identity } from '@effect/data/Function';
import { Brand_refined, Either_fromPredicate, Struct_get } from '../utils/Effect';
import { ST } from '../utils/EffectImports';
import { M } from '../utils/EffectImports';

export interface Counter extends D.Case {
    _tag: "Combinatorics.Counter";
    readonly hits: number;
    readonly total: number;
};

const Counter = D.tagged<Counter>("Combinatorics.Counter");

export const empty: Counter = Counter({
    hits: 0,
    total: 0,
});

export const hitN = (n: number): ((counter: Counter) => Counter) =>
    flow(
        ST.pick('hits', 'total'),

        ST.evolve({
            hits: current => current + n,
            total: current => current + n,
        }),

        Counter,
    );

export const hit: (count: Counter) => Counter =
        hitN(1);

export const missN = (n: number): ((counter: Counter) => Counter) =>
    flow(
        ST.pick('hits', 'total'),

        ST.evolve({
            hits: identity<number>,
            total: current => current + n,
        }),

        Counter,
    );

export const miss: (count: Counter) => Counter =
        missN(1);

export const increment = (type: 'hit' | 'miss', n: number = 1): ((counter: Counter) => Counter) =>
    pipe(
        M.value(type),
        M.when('hit', () => hitN(n)),
        M.when('miss', () => missN(n)),
        M.exhaustive,
    );

export type Probability = Counter & B.Brand<'Combinatorics.Probability'>;

export const Probability = Brand_refined<Probability>([
    Either_fromPredicate(
        P.contramap(N.greaterThan(0), Struct_get('total')),
        constant(B.error(`'total' must be > 0`)),
    ),

    Either_fromPredicate(
        P.contramap(N.greaterThanOrEqualTo(0), Struct_get('hits')),
        constant(B.error(`'hits' must be >= 0`)),
    ),

    Either_fromPredicate(
        ({ hits, total }) => pipe(hits, N.lessThanOrEqualTo(total)),
        constant(B.error(`'hits' must be <= 'total'`)),
    ),
]);

export const isZero: P.Predicate<Probability> =
    P.contramap(
        EQ.equals(0),
        Struct_get('hits'),
    );

export const isOne: P.Predicate<Probability> =
    ({ hits, total }) => EQ.equals(hits, total);

export const not: (prob: Probability) => Probability =
    flow(
        ST.pick('hits', 'total'),

        ({ hits, total }) => ({
            hits: total - hits,
            total,
        }),

        Counter,
        Probability,
        E.getOrThrow,
    );

export const toDecimal = (prob: Probability): number =>
    prob.hits / prob.total;
