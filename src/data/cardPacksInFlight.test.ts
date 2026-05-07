import { describe, expect, test } from "vitest";
import { drainInFlight, trackInFlight } from "./cardPacksInFlight";

/**
 * Build a "deferred" Promise — a Promise plus its resolve/reject
 * callbacks so the test controls when it settles. The
 * `flushPendingChanges` reconcile loop calls `drainInFlight()`
 * before evaluating localStorage; the registry's contract is that
 * once every tracked Promise has settled, `drainInFlight` resolves.
 */
const deferred = <T = void>(): {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (reason: unknown) => void;
} => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const tick = () => new Promise(r => setTimeout(r, 0));

describe("trackInFlight + drainInFlight", () => {
    test("drainInFlight resolves immediately when registry is empty", async () => {
        await drainInFlight();
        // No assertion needed — just that it doesn't hang.
    });

    test("drainInFlight waits for a tracked Promise to settle", async () => {
        const d = deferred<string>();
        trackInFlight(d.promise);

        let drained = false;
        const drainPromise = drainInFlight().then(() => {
            drained = true;
        });

        // Yield once so any pending micro-tasks would settle if they
        // could; drain should still be pending.
        await tick();
        expect(drained).toBe(false);

        d.resolve("done");
        await drainPromise;
        expect(drained).toBe(true);
    });

    test("drainInFlight waits for ALL tracked Promises to settle", async () => {
        const a = deferred<string>();
        const b = deferred<string>();
        const c = deferred<string>();
        trackInFlight(a.promise);
        trackInFlight(b.promise);
        trackInFlight(c.promise);

        let drained = false;
        const drainPromise = drainInFlight().then(() => {
            drained = true;
        });

        a.resolve("a");
        await tick();
        expect(drained).toBe(false);

        b.resolve("b");
        await tick();
        expect(drained).toBe(false);

        c.resolve("c");
        await drainPromise;
        expect(drained).toBe(true);
    });

    test("a rejected Promise still releases drainInFlight", async () => {
        const d = deferred<string>();
        // trackInFlight returns the original Promise; the registry's
        // own `.catch` handler swallows the rejection internally so
        // that `Promise.allSettled` inside `drainInFlight` doesn't
        // see an unhandled rejection.
        trackInFlight(d.promise).catch(() => undefined);

        let drained = false;
        const drainPromise = drainInFlight().then(() => {
            drained = true;
        });

        await tick();
        expect(drained).toBe(false);

        d.reject(new Error("boom"));
        await drainPromise;
        expect(drained).toBe(true);
    });

    test("Promises tracked AFTER drainInFlight starts are also awaited", async () => {
        // Real-world race: an in-flight save kicks off, then while
        // it's settling another save fires (e.g. user mashes the
        // Save button). drainInFlight should not resolve until both
        // have settled.
        const a = deferred<string>();
        trackInFlight(a.promise);

        let drained = false;
        const drainPromise = drainInFlight().then(() => {
            drained = true;
        });

        // Settle `a`, but synchronously add `b` before the drain
        // gets a chance to observe an empty registry.
        const b = deferred<string>();
        a.resolve("a");
        trackInFlight(b.promise);

        await tick();
        await tick();
        expect(drained).toBe(false);

        b.resolve("b");
        await drainPromise;
        expect(drained).toBe(true);
    });

    test("trackInFlight returns the original Promise (so callers can await it)", async () => {
        const d = deferred<string>();
        const tracked = trackInFlight(d.promise);
        // Identity, not a wrapped Promise.
        expect(tracked).toBe(d.promise);
        d.resolve("ok");
        await expect(tracked).resolves.toBe("ok");
    });

    test("settled Promises don't keep drain pending on a subsequent call", async () => {
        const a = deferred<string>();
        trackInFlight(a.promise);
        a.resolve("a");
        // Allow the registry's `.finally` handler to remove the
        // entry.
        await tick();
        await tick();
        // Drain should be a no-op now.
        await drainInFlight();
    });
});
