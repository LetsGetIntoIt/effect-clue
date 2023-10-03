import { test as jest_test } from '@jest/globals';
import { Effect } from 'effect';

export const test = (name: string, effect: Effect.Effect<never, never, void>): void =>
    jest_test(name, async () => {
        await Effect.runPromise(effect);
    });

export const effectOrFail: <R, E, A>(
    effect: Effect.Effect<R, E, A>,
) => Effect.Effect<R, never, A> =
    Effect.catchAll(e => {
        expect(e).toBeUndefined();
        return Effect.die(e);
    });
