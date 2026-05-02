/**
 * Sentry server SDK init for the Node.js runtime.
 *
 * Pulled in lazily by `instrumentation.ts`'s `register()` hook only
 * when `NEXT_RUNTIME === "nodejs"`, so this file never runs in the
 * browser, in the edge runtime, or during static analysis. Treat it
 * like a side-effecting module: importing it is what wires Sentry up.
 *
 * Init is gated on `SENTRY_DSN` (with a fallback to
 * `NEXT_PUBLIC_SENTRY_DSN` so the same DSN works on both sides
 * without duplicate env vars). When neither is set we silently no-op
 * — local dev without Sentry credentials runs unchanged.
 *
 * Session Replay and the browser-only PII masking config live in
 * `instrumentation-client.ts`; the server SDK has no equivalents.
 */
import * as Sentry from "@sentry/nextjs";

const dsn =
    process.env["SENTRY_DSN"] ?? process.env["NEXT_PUBLIC_SENTRY_DSN"];

if (dsn) {
    Sentry.init({
        dsn,
        environment:
            process.env["VERCEL_ENV"]
            ?? process.env["NEXT_PUBLIC_VERCEL_ENV"]
            ?? "development",
        release:
            process.env["VERCEL_GIT_COMMIT_SHA"]
            ?? process.env["NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA"],
        // Capture all transactions during early production rollout. Once
        // we have data, lower this to e.g. 0.1 to control event volume.
        // Mirrors `instrumentation-client.ts` so client + server traces
        // stay sampled at the same rate while we're calibrating.
        tracesSampleRate: 1.0,
    });
}
