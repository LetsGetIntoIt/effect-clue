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
 *
 * As of the startup coordinator (M20+), the gate's "should I show"
 * decision is delegated to `<StartupCoordinatorProvider>` so the
 * splash plays nicely with the tour and install prompt instead of
 * stacking on top of them. The coordinator's `phase === "splash"`
 * is the canonical source of truth; this hook just bumps
 * `lastVisitedAt`, fires telemetry once when the splash actually
 * opens, and persists `lastDismissedAt` on dismiss.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DateTime, Duration, Effect } from "effect";
import { TelemetryRuntime } from "../../observability/runtime";
import { splashScreenViewed } from "../../analytics/events";
import {
    loadSplashState,
    saveDismissed,
    saveLastVisited,
    type SplashState,
} from "../../logic/SplashState";
import { useStartupCoordinator } from "../onboarding/StartupCoordinator";

export const ABOUT_APP_SPLASH_SCREEN_DISMISSAL_DURATION = Duration.weeks(4);

// Coordinator slot discriminator. Pulled out as a constant so the
// `i18next/no-literal-string` lint rule treats it as a wire-format
// identifier rather than user copy.
const SLOT_SPLASH = "splash" as const;

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
    /** True when the coordinator says the splash slot is active. */
    readonly showSplash: boolean;
    /** Whether the user has previously checked "don't show again". */
    readonly dismissedBefore: boolean;
    /** Hides the splash; persists `lastDismissedAt` if `dontShowAgain`. */
    readonly dismiss: (dontShowAgain: boolean) => void;
} {
    const { phase, reportClosed } = useStartupCoordinator();
    const [dismissedBefore, setDismissedBefore] = useState(false);

    // Side effects on mount: bump `lastVisitedAt` and snapshot
    // `dismissedBefore` for the modal copy. Order is critical — the
    // coordinator reads `lastVisitedAt` BEFORE this hook bumps it, so
    // both agree on the gate decision. (Coordinator runs its
    // eligibility effect on hydration; this hook also gates on a
    // mount-only effect, so React schedules them in the same flush.)
    useEffect(() => {
        const state = loadSplashState();
        setDismissedBefore(state.lastDismissedAt !== undefined);
        saveLastVisited(DateTime.nowUnsafe());
    }, []);

    // Fire `splash_screen_viewed` exactly once when the coordinator
    // actually opens the splash (`phase === "splash"`). Previously
    // the event fired alongside the gate decision, but with the
    // coordinator we only want it tied to actual visibility.
    const viewedFired = useRef(false);
    useEffect(() => {
        if (phase !== "splash") return;
        if (viewedFired.current) return;
        viewedFired.current = true;
        const state = loadSplashState();
        const now = DateTime.nowUnsafe();
        // We still run the pure gate through the telemetry runtime so
        // the `splash.computeGate` span keeps appearing on Honeycomb
        // — even though the coordinator already decided.
        TelemetryRuntime.runSync(
            computeShouldShowSplash(
                state,
                now,
                ABOUT_APP_SPLASH_SCREEN_DISMISSAL_DURATION,
            ),
        );
        const dismissedBefore = state.lastDismissedAt !== undefined;
        const daysSinceLastVisit =
            state.lastVisitedAt !== undefined
                ? daysBetween(state.lastVisitedAt, now)
                : null;
        const daysSinceLastDismissal =
            state.lastDismissedAt !== undefined
                ? daysBetween(state.lastDismissedAt, now)
                : null;
        // `reengaged` is true when the user previously dismissed the
        // splash AND the snooze window has elapsed — i.e. the splash
        // re-fired on its own after a dormant stretch. Mirrors the
        // gate condition in `computeShouldShowSplash` so the
        // dashboard's "reengaged" filter matches the code's gate
        // exactly.
        const reengaged =
            dismissedBefore &&
            state.lastVisitedAt !== undefined &&
            Duration.isGreaterThan(
                DateTime.distance(state.lastVisitedAt, now),
                ABOUT_APP_SPLASH_SCREEN_DISMISSAL_DURATION,
            );
        splashScreenViewed({
            dismissedBefore,
            daysSinceLastVisit,
            reengaged,
            daysSinceLastDismissal,
        });
    }, [phase]);

    const dismiss = useCallback(
        (dontShowAgain: boolean) => {
            if (dontShowAgain) {
                saveDismissed(DateTime.nowUnsafe());
                setDismissedBefore(true);
            }
            reportClosed(SLOT_SPLASH);
        },
        [reportClosed],
    );

    return {
        showSplash: phase === SLOT_SPLASH,
        dismissedBefore,
        dismiss,
    };
}
