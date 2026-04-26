/**
 * Top-level client provider that initialises browser-side
 * observability (PostHog + Web Vitals listener) on first mount.
 *
 * Sentry init runs out-of-band via `instrumentation-client.ts` (Next.js
 * convention) so it's not wired here. Honeycomb / OTel is wired
 * lazily through `TelemetryRuntime` whenever Effect code runs.
 */
"use client";

import { useEffect } from "react";
import { appLoaded } from "../src/analytics/events";
import { initPosthog } from "../src/analytics/posthog";
import { initWebVitals } from "../src/analytics/webVitals";

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
    return <>{children}</>;
};
