/**
 * Registers the Serwist-emitted `public/sw.js` on first client
 * render.
 *
 * Without this, the service worker file gets compiled to
 * `public/sw.js` by `@serwist/next`'s build hook (see
 * `next.config.ts`) but the browser never picks it up — there's no
 * `navigator.serviceWorker.register("/sw.js")` call anywhere.
 * Modern Chrome (90+) accepts a PWA install with no SW (just a
 * manifest + a ≥192px icon), which is why a Pixel install
 * succeeded on M5; but with no SW running, every navigation hits
 * the network, and offline visits get Chrome's "you are offline"
 * splash instead of the cached app shell.
 *
 * Registration is a one-shot side effect on mount. Failure logs to
 * Sentry (auto-captured by the existing `Effect.logError` path)
 * but doesn't block the rest of the app — non-Chromium browsers
 * silently no-op when `navigator.serviceWorker` is undefined.
 *
 * Skipped in development to avoid fighting a stale dev SW (Serwist
 * itself sets `disable: true` in dev when emitting `sw.js`, so the
 * file wouldn't exist anyway, but the early-return is belt-and-
 * braces and keeps the dev console quiet).
 */
"use client";

import { useEffect } from "react";
import { Effect } from "effect";
import { TelemetryRuntime } from "../observability/runtime";

const SW_PATH = "/sw.js";
const SW_SCOPE = "/";

const registerEffect = Effect.fn("pwa.register-sw")(function* (
    path: string,
    scope: string,
) {
    return yield* Effect.tryPromise({
        try: () => navigator.serviceWorker.register(path, { scope }),
        catch: cause => new Error(`SW registration failed: ${String(cause)}`),
    });
});

export function ServiceWorkerRegistration(): null {
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (process.env["NODE_ENV"] === "development") return;
        if (!("serviceWorker" in navigator)) return;
        TelemetryRuntime.runPromise(
            registerEffect(SW_PATH, SW_SCOPE).pipe(
                Effect.tapError(cause =>
                    Effect.logError("pwa.register-sw failed", { cause }),
                ),
                Effect.ignore,
            ),
        ).catch(() => {
            // `runPromise` already drained errors via the
            // `Effect.tapError` above; the `.catch` here is a final
            // belt-and-braces guard so an unexpected runtime panic
            // can't propagate into React's error boundary.
        });
    }, []);
    return null;
}
