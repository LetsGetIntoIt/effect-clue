/**
 * Sentry browser SDK init. Next.js 16 picks this file up automatically
 * for client-side instrumentation.
 *
 * Init is gated on `NEXT_PUBLIC_SENTRY_DSN` so local dev without a
 * DSN is a silent no-op — Sentry never phones home, no console noise.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env["NEXT_PUBLIC_SENTRY_DSN"];

if (dsn) {
    Sentry.init({
        dsn,
        environment: process.env["NEXT_PUBLIC_VERCEL_ENV"] ?? "development",
        release: process.env["NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA"],
        // Capture all transactions during early production rollout. Once
        // we have data, lower this to e.g. 0.1 to control event volume.
        tracesSampleRate: 1.0,
        // Session Replay: 10% of all sessions, 100% on error. PII-safe
        // defaults — DOM text masked, media blocked.
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        integrations: [
            Sentry.replayIntegration({
                maskAllText: true,
                blockAllMedia: true,
            }),
        ],
    });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
