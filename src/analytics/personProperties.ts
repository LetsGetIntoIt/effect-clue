/**
 * Helpers for layering PostHog person-property updates onto the
 * typed event emitters in `events.ts`.
 *
 * PostHog reads two reserved keys from any event payload:
 *
 *   `$set`       — overwrites the named person properties every time.
 *                  Use for state whose *latest* value matters (e.g.
 *                  `install_status`, `tour_<screenKey>_status`).
 *   `$set_once`  — write-once. Subsequent writes from the SDK are
 *                  ignored. Use for first-touch timestamps so a
 *                  returning user's `first_splash_viewed_at` doesn't
 *                  drift forward.
 *
 * The `withPersonProperties` helper returns the `$set` / `$set_once`
 * shape the existing `capture()` wrapper in `events.ts` already
 * passes through to PostHog verbatim — no infrastructure change.
 *
 * The status-string type aliases below pin the discriminator values
 * we set. Free-form strings would also work, but typing them at the
 * source means a typo in an emitter is a TypeScript error rather
 * than a silent dashboard drift.
 */
"use client";

import { DateTime } from "effect";

/** Splash modal lifecycle status, kept as a per-user latest value. */
export type SplashStatus =
    | "viewed"
    | "dismissed_with_dontshow"
    | "dismissed_no_dontshow";

/** PWA install-prompt lifecycle status. */
export type InstallStatus =
    | "prompted"
    | "accepted"
    | "completed"
    | "dismissed_snoozed"
    | "dismissed_native_decline";

/** Per-tour lifecycle status, written under `tour_<screenKey>_status`. */
export type TourStatus =
    | "started"
    | "completed"
    | "dismissed_skip"
    | "dismissed_close"
    | "dismissed_esc"
    | "dismissed_anchor_missing"
    | "abandoned";

/** Convert a `DateTime.Utc` to the ISO-8601 string PostHog stores. */
export const personIso = (dt: DateTime.Utc): string =>
    new Date(DateTime.toEpochMillis(dt)).toISOString();

interface PersonPropertyPatch {
    readonly $set?: Readonly<Record<string, unknown>>;
    readonly $set_once?: Readonly<Record<string, unknown>>;
}

/**
 * Build the `$set` / `$set_once` keys PostHog reads from an event
 * payload. Drops empty bags so we don't send `$set: {}` and bloat the
 * wire format. Designed to be spread into the emitter's capture
 * payload alongside the event-specific properties.
 */
export const withPersonProperties = (
    set?: Readonly<Record<string, unknown>>,
    setOnce?: Readonly<Record<string, unknown>>,
): PersonPropertyPatch => {
    const patch: {
        $set?: Readonly<Record<string, unknown>>;
        $set_once?: Readonly<Record<string, unknown>>;
    } = {};
    if (set !== undefined && Object.keys(set).length > 0) {
        patch.$set = set;
    }
    if (setOnce !== undefined && Object.keys(setOnce).length > 0) {
        patch.$set_once = setOnce;
    }
    return patch;
};
