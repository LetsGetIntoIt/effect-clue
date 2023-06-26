import { T } from "./EffectImports";

export const Effect_test: (effect: T.Effect<never, never, void>) => Promise<void> =
    T.runPromise;

export const Effect_expectSucceed: <R, E, A>(
    effect: T.Effect<R, E, A>,
) => T.Effect<R, never, A> =
    T.catchAll(e => {
        expect(e).toBeUndefined();
        return T.die(e);
    });
