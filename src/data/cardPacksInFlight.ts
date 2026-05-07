/**
 * Module-scoped registry of in-flight server-mirror Promises for
 * card-pack mutations.
 *
 * The reconcile loop (`applyServerSnapshot`) and the logout
 * `flushPendingChanges` helper both `await drainInFlight()` before
 * inspecting localStorage, so an in-progress save / delete is given
 * a chance to settle (clearing or retaining `unsyncedSince`) before
 * we decide whether to warn the user.
 *
 * Lives in its own file to avoid a circular import between
 * `customCardPacks.ts` (which produces Promises) and
 * `cardPacksSync.tsx` (which drains them).
 */

const inFlight = new Set<Promise<unknown>>();

/**
 * Add a Promise to the registry; auto-removes it on settle.
 */
export const trackInFlight = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise);
    promise
        .catch(() => undefined)
        .finally(() => {
            inFlight.delete(promise);
        });
    return promise;
};

/**
 * Wait for every currently-tracked Promise to settle. Loops in case
 * a settling Promise spawns another (defensive — typically one pass
 * suffices).
 */
export const drainInFlight = async (): Promise<void> => {
    while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
    }
};
