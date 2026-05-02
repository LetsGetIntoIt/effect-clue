/**
 * Decides whether a per-screen onboarding tour should fire on mount,
 * and exposes a `dismiss()` callback for any of the
 * skip / complete / X / Esc paths to call.
 *
 * Gate (read both timestamps before writing the new visit):
 *
 *   show = lastDismissedAt is undefined           // never dismissed
 *       OR lastVisitedAt is undefined             // first visit
 *       OR (now − lastVisitedAt) > DURATION       // dormant returnee
 *
 * Same shape as `useSplashGate` — the splash modal sets the
 * convention for the whole "dismiss + 4-week re-engage" cadence and
 * each tour just reuses it under its own per-screen storage key.
 */
"use client";

import { useEffect, useState } from "react";
import { DateTime, Duration, Effect } from "effect";
import { TelemetryRuntime } from "../../observability/runtime";
import { TOUR_RE_ENGAGE_DURATION } from "./tours";
import {
    loadTourState,
    saveTourDismissed,
    saveTourVisited,
    type ScreenKey,
    type TourState,
} from "./TourState";

// Re-exported for callers that already import from this module.
export { TOUR_RE_ENGAGE_DURATION };

export const computeShouldShowTour = Effect.fn("tour.computeGate")(
    function* (
        state: TourState,
        now: DateTime.Utc,
        duration: Duration.Duration,
    ) {
        if (state.lastDismissedAt === undefined) return true;
        if (state.lastVisitedAt === undefined) return true;
        const elapsed = DateTime.distance(state.lastVisitedAt, now);
        return Duration.isGreaterThan(elapsed, duration);
    },
);

interface UseTourGateOptions {
    /** When false, the gate never fires. Used to defer per-screen tours
     * until the user is actually on that screen. */
    readonly enabled?: boolean;
}

export function useTourGate(
    screen: ScreenKey,
    options: UseTourGateOptions = {},
): {
    /** True after mount when the gate decided to show this screen's tour. */
    readonly shouldShow: boolean;
    /** Dismisses the tour and persists `lastDismissedAt`. */
    readonly dismiss: () => void;
} {
    const enabled = options.enabled ?? true;
    const [shouldShow, setShouldShow] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        const state = loadTourState(screen);
        const now = DateTime.nowUnsafe();
        const should = TelemetryRuntime.runSync(
            computeShouldShowTour(state, now, TOUR_RE_ENGAGE_DURATION),
        );
        // Always reflect the current screen's gate decision. Earlier
        // versions only set on `should=true` — that left stale `true`
        // state from a previous screen visible to the firing
        // effect when the user navigated to a screen whose tour was
        // already dismissed.
        setShouldShow(should);
        // Order is critical: read state and decide BEFORE we overwrite
        // the visit timestamp, otherwise the gap is always 0.
        saveTourVisited(screen, now);
    }, [enabled, screen]);

    const dismiss = () => {
        saveTourDismissed(screen, DateTime.nowUnsafe());
        setShouldShow(false);
    };

    return { shouldShow, dismiss };
}
