/**
 * Web Vitals listener — wires browser performance metrics to both
 * PostHog (as named events for funnels and dashboards) and Honeycomb
 * (as a span attributes via the active OTel span on the active runtime).
 *
 * Sentry already auto-captures Web Vitals as performance transactions,
 * so this is the cross-system mirror for product analytics.
 */
"use client";

import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import { webVital } from "./events";

type VitalName = "lcp" | "inp" | "cls" | "ttfb" | "fcp";

const ratingFor = (
    rating: "good" | "needs-improvement" | "poor",
): "good" | "needs-improvement" | "poor" => rating;

const report = (name: VitalName) =>
    (m: { value: number; rating: "good" | "needs-improvement" | "poor" }) => {
        webVital({ name, value: m.value, rating: ratingFor(m.rating) });
    };

let registered = false;

export const initWebVitals = (): void => {
    if (registered) return;
    if (typeof window === "undefined") return;
    onLCP(report("lcp"));
    onINP(report("inp"));
    onCLS(report("cls"));
    onTTFB(report("ttfb"));
    onFCP(report("fcp"));
    registered = true;
};
