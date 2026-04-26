/**
 * Decides whether to show the about-app splash modal on `/play` mount.
 *
 * Gate (read both timestamps before writing the new visit):
 *
 *   show = lastDismissedAt is undefined           // never opted out
 *       OR lastVisitedAt is undefined             // first visit
 *       OR (now − lastVisitedAt) > DURATION       // dormant returnee
 *
 * Active users who opted out stay dismissed as long as they keep
 * visiting; users who've been away ≥ DURATION see the splash again
 * as a re-engagement nudge. The DURATION lives in code so we can tune
 * it without a migration.
 */
"use client";

import { useEffect, useState } from "react";
import { DateTime, Duration, Effect } from "effect";
import { TelemetryRuntime } from "../../observability/runtime";
import { splashScreenViewed } from "../../analytics/events";
import {
    loadSplashState,
    saveDismissed,
    saveLastVisited,
    type SplashState,
} from "../../logic/SplashState";

export const ABOUT_APP_SPLASH_SCREEN_DISMISSAL_DURATION = Duration.weeks(4);

export const computeShouldShowSplash = Effect.fn("splash.computeGate")(
    function* (
        state: SplashState,
        now: DateTime.Utc,
        duration: Duration.Duration,
    ) {
        if (state.lastDismissedAt === undefined) return true;
        if (state.lastVisitedAt === undefined) return true;
        const elapsed = DateTime.distance(state.lastVisitedAt, now);
        return Duration.isGreaterThan(elapsed, duration);
    },
);

const daysBetween = (from: DateTime.Utc, to: DateTime.Utc): number => {
    const ms = Duration.toMillis(DateTime.distance(from, to));
    return Math.floor(ms / Duration.toMillis(Duration.days(1)));
};

export function useSplashGate(): {
    /** True after mount when the gate decided to show. */
    readonly showSplash: boolean;
    /** Whether the user has previously checked "don't show again". */
    readonly dismissedBefore: boolean;
    /** Hides the splash; persists `lastDismissedAt` if `dontShowAgain`. */
    readonly dismiss: (dontShowAgain: boolean) => void;
} {
    const [showSplash, setShowSplash] = useState(false);
    const [dismissedBefore, setDismissedBefore] = useState(false);

    useEffect(() => {
        const state = loadSplashState();
        const now = DateTime.nowUnsafe();
        const should = TelemetryRuntime.runSync(
            computeShouldShowSplash(
                state,
                now,
                ABOUT_APP_SPLASH_SCREEN_DISMISSAL_DURATION,
            ),
        );
        const wasDismissedBefore = state.lastDismissedAt !== undefined;
        setDismissedBefore(wasDismissedBefore);
        if (should) {
            setShowSplash(true);
            splashScreenViewed({
                dismissedBefore: wasDismissedBefore,
                daysSinceLastVisit:
                    state.lastVisitedAt !== undefined
                        ? daysBetween(state.lastVisitedAt, now)
                        : null,
            });
        }
        // Order is critical: read state and decide BEFORE we overwrite
        // the visit timestamp, otherwise the gap is always 0.
        saveLastVisited(now);
    }, []);

    const dismiss = (dontShowAgain: boolean) => {
        if (dontShowAgain) {
            saveDismissed(DateTime.nowUnsafe());
            setDismissedBefore(true);
        }
        setShowSplash(false);
    };

    return { showSplash, dismissedBefore, dismiss };
}
