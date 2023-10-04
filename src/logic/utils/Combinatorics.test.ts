import { Effect, HashSet } from "effect";

import { test } from "../test-utils/EffectTest";
import '../test-utils/EffectExpectEquals';
import { Combinatorics, combinatoricsLive } from "./Combinatorics";

describe('Combinatorics', () => {
    describe('factorial', () => {
        test('it works', Effect.gen(function* ($) {
            const { factorial } = yield* $(Combinatorics.pipe(
                Effect.provideLayer(combinatoricsLive),
            ));
    
            expect(yield* $(factorial(0))).toEqual(1n);
            expect(yield* $(factorial(1))).toEqual(1n);
            expect(yield* $(factorial(2))).toEqual(2n);
            expect(yield* $(factorial(3))).toEqual(6n);
            expect(yield* $(factorial(4))).toEqual(24n);
        }));
    });

    describe('binomial', () => {
        test('it works', Effect.gen(function* ($) {
            const { binomial } = yield* $(Combinatorics.pipe(
                Effect.provideLayer(combinatoricsLive),
            ));
    
            expect(yield* $(binomial(0, 0))).toEqual(1n);
            expect(yield* $(binomial(1, 0))).toEqual(1n);
            expect(yield* $(binomial(2, 0))).toEqual(1n);
            expect(yield* $(binomial(3, 0))).toEqual(1n);
            expect(yield* $(binomial(4, 0))).toEqual(1n);

            expect(yield* $(binomial(0, 1))).toEqual(1n);
            expect(yield* $(binomial(1, 1))).toEqual(1n);
            expect(yield* $(binomial(2, 1))).toEqual(2n);
            expect(yield* $(binomial(3, 1))).toEqual(3n);
            expect(yield* $(binomial(4, 1))).toEqual(4n);

            expect(yield* $(binomial(0, 0))).toEqual(1n);
            expect(yield* $(binomial(1, 1))).toEqual(1n);
            expect(yield* $(binomial(2, 2))).toEqual(1n);
            expect(yield* $(binomial(3, 3))).toEqual(1n);
            expect(yield* $(binomial(4, 4))).toEqual(1n);

            expect(yield* $(binomial(0, 0))).toEqual(1n);
            expect(yield* $(binomial(1, 0))).toEqual(1n);
            expect(yield* $(binomial(2, 1))).toEqual(2n);
            expect(yield* $(binomial(3, 2))).toEqual(3n);
            expect(yield* $(binomial(4, 3))).toEqual(4n);

            expect(yield* $(binomial(8, 2))).toEqual(28n);
            expect(yield* $(binomial(5, 3))).toEqual(10n);
            expect(yield* $(binomial(10, 2))).toEqual(45n);
        }));
    });

    describe('subsets', () => {
        test('it works', Effect.gen(function* ($) {
            const { subsets } = yield* $(Combinatorics.pipe(
                Effect.provideLayer(combinatoricsLive),
            ));
    
            const result = yield* $(subsets(
                HashSet.make('a', 'b', 'c'),
            ));
    
            expect(result).toEqual(HashSet.make(
                HashSet.empty(),
                HashSet.make('a'),
                HashSet.make('b'),
                HashSet.make('c'),
                HashSet.make('a', 'b'),
                HashSet.make('a', 'c'),
                HashSet.make('b', 'c'),
                HashSet.make('a', 'b', 'c'),
            ));
        }));
    });
});
