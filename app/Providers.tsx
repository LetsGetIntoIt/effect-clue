/**
 * Top-level client providers. Two responsibilities:
 *
 *   1. Browser-side observability bootstrap — initialise PostHog +
 *      Web Vitals listener on first mount. Sentry init runs out-of-
 *      band via `instrumentation-client.ts` (Next.js convention) so
 *      it's not wired here; Honeycomb / OTel is wired lazily
 *      through `TelemetryRuntime` whenever Effect code runs.
 *
 *   2. React Query — mounts a single QueryClient + persister for the
 *      whole app via `QueryClientProvider` (see
 *      [src/data/QueryClientProvider.tsx](../src/data/QueryClientProvider.tsx)),
 *      so every query / mutation across the tree shares one cache and
 *      one localStorage-backed persister.
 */
"use client";

import { useEffect } from "react";
import { appLoaded } from "../src/analytics/events";
import { initPosthog } from "../src/analytics/posthog";
import { initWebVitals } from "../src/analytics/webVitals";
import { QueryClientProvider } from "../src/data/QueryClientProvider";

export const Providers = ({
    children,
}: {
    children: React.ReactNode;
}): React.ReactElement => {
    useEffect(() => {
        initPosthog();
        initWebVitals();
        appLoaded({
            coldStart: !document.referrer,
            language: navigator.language,
            appVersion:
                process.env["NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA"] ?? "dev",
        });
    }, []);
    return <QueryClientProvider>{children}</QueryClientProvider>;
};
