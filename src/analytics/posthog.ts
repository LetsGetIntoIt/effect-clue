/**
 * PostHog browser SDK init.
 *
 * Init is gated on `NEXT_PUBLIC_POSTHOG_KEY` so local dev without
 * the key is a silent no-op — no events fire, no console noise.
 *
 * Privacy posture:
 * - `person_profiles: "identified_only"` — never create profiles for
 *   people who haven't been identified, to avoid auto-creating
 *   ghost users.
 * - `respect_dnt: true` — honour the browser's Do Not Track setting.
 * - `autocapture: false` — we emit explicit named events from
 *   `src/analytics/events.ts` so the schema stays under our control.
 * - Anonymous random UUID via `getOrCreateAnonymousUserId()`. No PII.
 */
"use client";

import posthog from "posthog-js";
import { getOrCreateAnonymousUserId } from "./userId";

let initialized = false;

export const initPosthog = (): void => {
    if (initialized) return;
    if (typeof window === "undefined") return;
    const key = process.env["NEXT_PUBLIC_POSTHOG_KEY"];
    if (!key) return;

    posthog.init(key, {
        api_host:
            process.env["NEXT_PUBLIC_POSTHOG_HOST"] ?? "https://us.i.posthog.com",
        person_profiles: "identified_only",
        autocapture: false,
        capture_pageview: true,
        capture_pageleave: true,
        respect_dnt: true,
        loaded: (ph) => {
            ph.identify(getOrCreateAnonymousUserId());
        },
    });
    initialized = true;
};

/**
 * Update the PostHog "super-properties" set — values attached to every
 * subsequent event without each emitter having to know about them.
 * Safe to call before `initPosthog`: when PostHog isn't loaded yet,
 * this is a no-op rather than a throw.
 *
 * Used today for `teach_mode_active` so every event (suggestion logged,
 * case file solved, $pageview, etc.) carries the user's teach-mode
 * state without modifying every call site. Toggle teach-mode mid-
 * session and the super-property updates; the next event ships with
 * the new value.
 */
export const registerSuperProperties = (
    props: Readonly<Record<string, unknown>>,
): void => {
    if (typeof window === "undefined") return;
    if (!posthog.__loaded) return;
    posthog.register(props);
};

export { posthog };
