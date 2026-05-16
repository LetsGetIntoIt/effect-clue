/**
 * Decides whether a per-screen onboarding tour should fire on mount,
 * and exposes a `dismiss()` callback for any of the
 * skip / complete / X / Esc paths to call.
 *
 * Gate (read both timestamps before writing the new visit), evaluated
 * per-mode:
 *
 *   show = state[mode].lastDismissedAt is undefined        // never dismissed in this mode
 *       OR (now − state[mode].referenceAt) > DURATION       // dormant returnee
 *
 * `referenceAt` is `lastVisitedAt` when present, falling back to
 * `lastDismissedAt`. That fallback matters for older or defensive
 * states that contain a valid dismissal without a visit timestamp:
 * the dismissal should still suppress the tour until the re-engage
 * window expires.
 *
 * **Delta mode**: when a user has completed the tour in the OTHER
 * mode recently (within the 4-week window) but never in the CURRENT
 * mode, the tour fires in "delta" mode — only the steps with
 * `requiredTeachMode === currentMode` render, skipping shared
 * structural steps the user already walked in the other mode. This
 * is signaled to the consumer via the `deltaMode` flag returned by
 * the hook; `TourProvider`'s step filter consumes it to drop the
 * shared steps.
 *
 * Same shape as `useSplashGate` — the splash modal sets the
 * convention for the whole "dismiss + 4-week re-engage" cadence and
 * each tour just reuses it under its own per-screen storage key.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { DateTime, Duration, Effect } from "effect";
import { TelemetryRuntime } from "../../observability/runtime";
import { TOUR_RE_ENGAGE_DURATION } from "./tours";
import {
    loadTourState,
    saveTourDismissed,
    saveTourVisited,
    TOUR_MODE_NORMAL,
    TOUR_MODE_TEACH,
    type ModeState,
    type ScreenKey,
    type TourMode,
} from "./TourState";

// Re-exported for callers that already import from this module.
export { TOUR_RE_ENGAGE_DURATION };

export const computeShouldShowTour = Effect.fn("tour.computeGate")(
    function* (
        state: ModeState | undefined,
        now: DateTime.Utc,
        duration: Duration.Duration,
    ) {
        if (state === undefined) return true;
        if (state.lastDismissedAt === undefined) return true;
        const referenceAt = state.lastVisitedAt ?? state.lastDismissedAt;
        const elapsed = DateTime.distance(referenceAt, now);
        return Duration.isGreaterThan(elapsed, duration);
    },
);

interface UseTourGateOptions {
    /** When false, the gate never fires. Used to defer per-screen tours
     * until the user is actually on that screen. */
    readonly enabled?: boolean;
}

interface GateDecision {
    readonly screen: ScreenKey;
    readonly mode: TourMode;
    readonly shouldShow: boolean;
    readonly deltaMode: boolean;
}

export function useTourGate(
    screen: ScreenKey,
    mode: TourMode,
    options: UseTourGateOptions = {},
): {
    /** True after mount when the gate decided to show this screen's tour. */
    readonly shouldShow: boolean;
    /**
     * True when the user already saw this tour in the OTHER mode
     * within the re-engage window. Consumers (the step filter)
     * use this to show only mode-specific steps rather than
     * re-walking shared structural steps.
     */
    readonly deltaMode: boolean;
    /** Dismisses the tour and persists `lastDismissedAt` for the current mode. */
    readonly dismiss: () => void;
} {
    const enabled = options.enabled ?? true;
    const [decision, setDecision] = useState<GateDecision>(() => ({
        screen,
        mode,
        shouldShow: false,
        deltaMode: false,
    }));

    useEffect(() => {
        if (!enabled) return;
        const state = loadTourState(screen);
        const now = DateTime.nowUnsafe();
        const currentModeState = state[mode];
        const otherModeState =
            state[mode === TOUR_MODE_NORMAL ? TOUR_MODE_TEACH : TOUR_MODE_NORMAL];
        const should = TelemetryRuntime.runSync(
            computeShouldShowTour(currentModeState, now, TOUR_RE_ENGAGE_DURATION),
        );
        // Delta mode: the user has dismissed/completed the tour in
        // the OTHER mode within the re-engage window. The structural
        // steps were already shown; only mode-specific differences
        // need to be walked.
        const otherShouldShow = TelemetryRuntime.runSync(
            computeShouldShowTour(otherModeState, now, TOUR_RE_ENGAGE_DURATION),
        );
        const deltaMode = should && !otherShouldShow;
        // Always reflect the current screen+mode's gate decision.
        // Earlier versions only set on `should=true` — that left
        // stale `true` state from a previous screen visible to the
        // firing effect when the user navigated to a screen whose
        // tour was already dismissed.
        setDecision({ screen, mode, shouldShow: should, deltaMode });
        // Order is critical: read state and decide BEFORE we overwrite
        // the visit timestamp, otherwise the gap is always 0.
        saveTourVisited(screen, mode, now);
    }, [enabled, screen, mode]);

    const dismiss = useCallback(() => {
        saveTourDismissed(screen, mode, DateTime.nowUnsafe());
        setDecision((prev) => ({ ...prev, shouldShow: false }));
    }, [screen, mode]);

    return {
        shouldShow:
            enabled && decision.screen === screen && decision.mode === mode
                ? decision.shouldShow
                : false,
        deltaMode:
            enabled && decision.screen === screen && decision.mode === mode
                ? decision.deltaMode
                : false,
        dismiss,
    };
}
