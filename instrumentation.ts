/**
 * Next.js 16 instrumentation hook.
 *
 * `register()` runs once at server start (and once per Vercel Function
 * cold-start). We use it to initialise the Sentry server SDK so
 * unhandled errors thrown during SSR / React Server Component
 * rendering / API routes / server actions reach Sentry.
 *
 * `onRequestError` is called by Next for every request error and
 * forwards it to Sentry — the App Router equivalent of Pages Router's
 * `_app`-level error boundaries.
 *
 * Browser-side init still lives in `instrumentation-client.ts`. Both
 * sides are gated on `NEXT_PUBLIC_SENTRY_DSN` (server falls back to
 * the unprefixed `SENTRY_DSN` if set), so local dev without a DSN is
 * a silent no-op on every runtime.
 */
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
    if (process.env["NEXT_RUNTIME"] === "nodejs") {
        await import("./sentry.server.config");
    }
    // Edge runtime intentionally omitted — none of our routes opt in
    // to the edge runtime today. Add `./sentry.edge.config` here if
    // a future route does.
}

export const onRequestError = Sentry.captureRequestError;
