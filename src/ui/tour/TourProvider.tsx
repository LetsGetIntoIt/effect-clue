/**
 * Tour state machine + context.
 *
 * Owns: which `screen`'s tour is active and which step within it
 * the user is on. Exposes start / next / back / dismiss as imperative
 * actions; the rendered `TourPopover` in `Clue.tsx` reads the active
 * tour from this context and renders accordingly.
 *
 * The gate logic — first visit + 4-week dormancy re-engage — lives
 * in `useTourGate`; this provider doesn't decide whether a tour
 * should fire on its own. It just exposes `startTour(screen)` for
 * gate-driven mounts to call after their mount-time gate decision.
 *
 * Each step transition emits an analytics event (`tour_started`,
 * `tour_step_advanced`, `tour_completed`, `tour_dismissed`) so we can
 * funnel onboarding completion. Restart-tour-from-the-overflow-menu
 * also routes through here via `restartCurrentScreenTour`.
 */
"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { DateTime, Duration, Effect } from "effect";
import {
    tourCompleted,
    tourDismissed,
    tourRestarted,
    tourStarted,
    tourStepAdvanced,
    tourStepViewed,
    type TourDismissVia,
} from "../../analytics/events";
import { TelemetryRuntime } from "../../observability/runtime";
import { useClueOptional } from "../state";
import { TOURS, type TourStep } from "./tours";
import {
    loadTourState,
    resetAllTourState,
    saveTourDismissed,
    tourModeFromTeachMode,
    type ModeState,
    type ScreenKey,
} from "./TourState";
import { useTourAbandonReporter } from "./useTourAbandonReporter";

interface TourContextValue {
    /** The currently-active tour, or undefined when no tour is showing. */
    readonly activeScreen: ScreenKey | undefined;
    /** 0-indexed step number within the active tour. */
    readonly stepIndex: number;
    /** The full step list for the active tour, or undefined. */
    readonly steps: ReadonlyArray<TourStep> | undefined;
    /** The current step, or undefined when no tour is showing. */
    readonly currentStep: TourStep | undefined;
    /** `false` when the active tour has more steps after the current one. */
    readonly isLastStep: boolean;
    /**
     * Begin a tour for `screen`, starting at step 0. `deltaMode`
     * defaults to false; when true, the step filter restricts to
     * steps with `requiredTeachMode === currentMode` (dropping
     * shared structural steps the user already saw in the other
     * mode).
     */
    readonly startTour: (
        screen: ScreenKey,
        options?: { readonly deltaMode?: boolean },
    ) => void;
    /** Advance to the next step, or fire `tourCompleted` and close. */
    readonly nextStep: () => void;
    /** Step back one. Clamps to 0; emits no events. */
    readonly prevStep: () => void;
    /** Dismiss the active tour. `via` is forwarded to `tour_dismissed`. */
    readonly dismissTour: (via: TourDismissVia) => void;
    /**
     * Wipe every per-screen tour-gate flag and immediately re-fire
     * the tour for `screen`. Used by the "Restart tour" overflow menu
     * item.
     */
    readonly restartTourForScreen: (screen: ScreenKey) => void;
}

const TourContext = createContext<TourContextValue | undefined>(undefined);

export const useTour = (): TourContextValue => {
    const ctx = useContext(TourContext);
    if (!ctx) {
        // eslint-disable-next-line i18next/no-literal-string -- developer-facing assertion.
        throw new Error("useTour must be used inside <TourProvider>");
    }
    return ctx;
};

const startEffect = Effect.fn("tour.start")(function* (screen: ScreenKey) {
    return screen;
});
const advanceEffect = Effect.fn("tour.advance")(function* (
    screen: ScreenKey,
    fromStep: number,
    toStep: number,
) {
    return { screen, fromStep, toStep };
});
const dismissEffect = Effect.fn("tour.dismiss")(function* (
    screen: ScreenKey,
    stepIndex: number,
    via: TourDismissVia,
) {
    return { screen, stepIndex, via };
});

// Module-scope viewport discriminators so the `i18next/no-literal-string`
// rule treats them as wire-format flags, not user copy.
const VIEWPORT_MOBILE = "mobile" as const;
const VIEWPORT_DESKTOP = "desktop" as const;
const VIEWPORT_BOTH = "both" as const;
const DESKTOP_BREAKPOINT_QUERY = "(min-width: 800px)";

/**
 * Filter `TOURS[screen]` to the steps that match the current viewport
 * breakpoint. Steps without a `viewport` field (the common case) are
 * always included; the only steps removed are ones explicitly tagged
 * `viewport: "mobile"` while running on desktop, or vice versa.
 *
 * The filtered list is what drives `currentStep`, `totalSteps`, the
 * "step N of M" counter, and the analytics event payloads — so a tour
 * that has 4 steps on desktop and 5 on mobile reports 4 / 5 to
 * PostHog respectively, rather than reporting 5 and silently
 * fast-forwarding past the desktop-skipped step.
 *
 * The breakpoint matches the rest of the app's mobile/desktop split
 * (BottomNav vs Toolbar; PlayLayout's single-pane vs side-by-side).
 */
const useFilterStepsByViewport = (
    allSteps: ReadonlyArray<TourStep>,
): ReadonlyArray<TourStep> => {
    const [isDesktop, setIsDesktop] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches;
    });
    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia(DESKTOP_BREAKPOINT_QUERY);
        const onChange = (): void => setIsDesktop(mq.matches);
        // `addEventListener` is the modern API; fall back to the
        // deprecated `addListener` for older Safari.
        if (typeof mq.addEventListener === "function") {
            mq.addEventListener("change", onChange);
            return () => mq.removeEventListener("change", onChange);
        }
        mq.addListener(onChange);
        return () => mq.removeListener(onChange);
    }, []);
    return useMemo(
        () =>
            allSteps.filter(step => {
                const v = step.viewport ?? VIEWPORT_BOTH;
                if (v === VIEWPORT_BOTH) return true;
                if (v === VIEWPORT_DESKTOP) return isDesktop;
                if (v === VIEWPORT_MOBILE) return !isDesktop;
                return true;
            }),
        [allSteps, isDesktop],
    );
};

/**
 * Filter the step list by `state.teachMode` and the optional
 * `deltaMode` flag.
 *
 * - **Normal mode (deltaMode false)**: keep steps where
 *   `requiredTeachMode === undefined` (shared) OR
 *   `requiredTeachMode === teachMode` (current-mode-specific).
 * - **Delta mode (deltaMode true)**: keep only
 *   `requiredTeachMode === teachMode`. Skip shared steps because
 *   the user already saw them in the other mode.
 *
 * Composes with `useFilterStepsByViewport`.
 */
const filterStepsByTeachMode = (
    steps: ReadonlyArray<TourStep>,
    teachMode: boolean,
    deltaMode: boolean,
): ReadonlyArray<TourStep> =>
    steps.filter(step => {
        if (deltaMode) {
            return step.requiredTeachMode === teachMode;
        }
        if (step.requiredTeachMode === undefined) return true;
        return step.requiredTeachMode === teachMode;
    });

// Empty array used as the no-active-tour stand-in so the viewport
// filter hook can run unconditionally (Rules of Hooks). Module-scope
// so React sees a stable identity across renders.
const EMPTY_STEPS: ReadonlyArray<TourStep> = [];

const daysBetween = (from: DateTime.Utc, to: DateTime.Utc): number => {
    const ms = Duration.toMillis(DateTime.distance(from, to));
    return Math.floor(ms / Duration.toMillis(Duration.days(1)));
};

/**
 * Compute the reengagement context for `tourStarted` from a screen's
 * persisted state. Pulled out so both auto-fire (`startTour`) and
 * manual restart (`restartTourForScreen`) can use it — manual
 * restart reads state BEFORE wiping it, so the analytics still
 * reflect the user's history.
 */
const tourReengagementContext = (
    state: ModeState | undefined,
    now: DateTime.Utc,
): { reengaged: boolean; daysSinceLastDismissal: number | null } => {
    const lastDismissedAt = state?.lastDismissedAt;
    if (lastDismissedAt === undefined) {
        return { reengaged: false, daysSinceLastDismissal: null };
    }
    return {
        reengaged: true,
        daysSinceLastDismissal: daysBetween(lastDismissedAt, now),
    };
};

export function TourProvider({ children }: { readonly children: ReactNode }) {
    const [activeScreen, setActiveScreen] = useState<ScreenKey | undefined>(
        undefined,
    );
    const [stepIndex, setStepIndex] = useState(0);
    /**
     * Whether the active tour was opened in delta mode. Set by
     * `startTour({ deltaMode: true })` when the gate detected the
     * user had already seen the other-mode variant. Drives the step
     * filter to drop shared structural steps.
     */
    const [activeDeltaMode, setActiveDeltaMode] = useState(false);

    // Filter happens BEFORE we expose `steps` to consumers so the
    // step counter, analytics, and the wrap-up `isLastStep` flag all
    // reflect the post-filter list. The filter is reactive — if the
    // user resizes between mobile and desktop mid-tour OR toggles
    // teach-mode mid-tour, the step count and (if needed) the
    // current index re-derive.
    const allSteps: ReadonlyArray<TourStep> =
        activeScreen ? TOURS[activeScreen] : EMPTY_STEPS;
    const filteredByViewport = useFilterStepsByViewport(allSteps);
    // `useClueOptional` returns undefined under bare-tree unit tests
    // that don't mount ClueProvider. Default teach-mode off in that
    // case — the filter then has no effect (steps with
    // `requiredTeachMode === false` show, ones with `true` are hidden,
    // ones with `undefined` always show).
    const teachModeForTour = useClueOptional()?.state.teachMode ?? false;
    const filteredSteps = useMemo(
        () =>
            filterStepsByTeachMode(
                filteredByViewport,
                teachModeForTour,
                activeDeltaMode,
            ),
        [filteredByViewport, teachModeForTour, activeDeltaMode],
    );
    const steps = activeScreen ? filteredSteps : undefined;
    const totalSteps = steps?.length ?? 0;
    // Clamp stepIndex to the live filtered list. Mid-tour mode
    // toggles can shrink the list (e.g., teach-mode-only steps
    // disappear when teach-mode flips off); without clamping,
    // `stepIndex` could point past the new end and `currentStep`
    // would render as `undefined`. The reverse case (a step appears
    // mid-tour because the user enabled teach-mode) is benign —
    // stepIndex stays in bounds.
    useEffect(() => {
        if (activeScreen === undefined) return;
        if (totalSteps > 0 && stepIndex >= totalSteps) {
            setStepIndex(totalSteps - 1);
        }
    }, [activeScreen, stepIndex, totalSteps]);
    const currentStep = steps?.[Math.min(stepIndex, totalSteps - 1)];
    const isLastStep = totalSteps > 0 && stepIndex >= totalSteps - 1;

    const teachModeForCallback = teachModeForTour;
    const startTour = useCallback(
        (
            screen: ScreenKey,
            options?: { readonly deltaMode?: boolean },
        ) => {
            // Match the filter the live `steps` will go through so the
            // analytics step count is consistent with what the user
            // actually sees. We run the same filter logic inline here
            // because the hook can only run inside the component body.
            const isDesktop =
                typeof window !== "undefined" &&
                window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches;
            const deltaMode = options?.deltaMode ?? false;
            const stepsForScreen = TOURS[screen].filter(step => {
                const v = step.viewport ?? VIEWPORT_BOTH;
                if (v === VIEWPORT_BOTH) {
                    /* viewport keep */
                } else if (v === VIEWPORT_DESKTOP && !isDesktop) return false;
                else if (v === VIEWPORT_MOBILE && isDesktop) return false;
                if (deltaMode) {
                    return step.requiredTeachMode === teachModeForCallback;
                }
                if (step.requiredTeachMode === undefined) return true;
                return step.requiredTeachMode === teachModeForCallback;
            });
            if (stepsForScreen.length === 0) return;
            TelemetryRuntime.runSync(startEffect(screen));
            const mode = tourModeFromTeachMode(teachModeForCallback);
            const reengage = tourReengagementContext(
                loadTourState(screen)[mode],
                DateTime.nowUnsafe(),
            );
            tourStarted({
                screenKey: screen,
                stepCount: stepsForScreen.length,
                ...reengage,
            });
            setActiveScreen(screen);
            setStepIndex(0);
            setActiveDeltaMode(deltaMode);
        },
        [teachModeForCallback],
    );

    const nextStep = useCallback(() => {
        if (!activeScreen || !steps) return;
        const next = stepIndex + 1;
        if (next < steps.length) {
            TelemetryRuntime.runSync(
                advanceEffect(activeScreen, stepIndex, next),
            );
            tourStepAdvanced({
                screenKey: activeScreen,
                fromStep: stepIndex,
                toStep: next,
                totalSteps: steps.length,
                direction: "forward",
            });
            setStepIndex(next);
            return;
        }
        // Past the last step — completion path. We persist
        // `lastDismissedAt` here too: the gate logic reads "show
        // unless dismissed-and-recent", so without this a user who
        // walked through every step (clicking Next on the closing
        // CTA) would see the same tour again on every page load.
        // Completion locks the tour the same way Skip / Esc / X do;
        // the analytics event still distinguishes the *reason* via
        // `tourCompleted` vs `tourDismissed`. Saved under the
        // current mode's subkey so each mode tracks its own
        // completion + 4-week clock.
        const completionMode = tourModeFromTeachMode(teachModeForCallback);
        saveTourDismissed(activeScreen, completionMode, DateTime.nowUnsafe());
        tourCompleted({
            screenKey: activeScreen,
            totalSteps: steps.length,
        });
        setActiveScreen(undefined);
        setStepIndex(0);
        setActiveDeltaMode(false);
    }, [activeScreen, stepIndex, steps, teachModeForCallback]);

    const prevStep = useCallback(() => {
        if (!activeScreen || !steps) return;
        if (stepIndex === 0) return;
        const prev = stepIndex - 1;
        TelemetryRuntime.runSync(
            advanceEffect(activeScreen, stepIndex, prev),
        );
        tourStepAdvanced({
            screenKey: activeScreen,
            fromStep: stepIndex,
            toStep: prev,
            totalSteps: steps.length,
            direction: "back",
        });
        setStepIndex(prev);
    }, [activeScreen, stepIndex, steps]);

    const dismissTour = useCallback(
        (via: TourDismissVia) => {
            if (!activeScreen) return;
            // Persist `lastDismissedAt` for the gate, under the
            // current mode's subkey. Each mode tracks its own
            // dismissal + 4-week clock.
            const dismissMode = tourModeFromTeachMode(teachModeForCallback);
            saveTourDismissed(activeScreen, dismissMode, DateTime.nowUnsafe());
            TelemetryRuntime.runSync(
                dismissEffect(activeScreen, stepIndex, via),
            );
            tourDismissed({
                screenKey: activeScreen,
                stepIndex,
                totalSteps: steps?.length ?? 0,
                via,
            });
            setActiveScreen(undefined);
            setStepIndex(0);
            setActiveDeltaMode(false);
        },
        [activeScreen, stepIndex, steps, teachModeForCallback],
    );

    const restartTourForScreen = useCallback(
        (screen: ScreenKey) => {
            // Read the dismissal state BEFORE wiping, so the analytics
            // payload reflects the user's actual history. After
            // `resetAllTourState()` runs, every mode's
            // `lastDismissedAt` is gone — but the user did dismiss
            // it before, and a manual restart is a reengagement
            // signal worth preserving. Read the current-mode subkey
            // for the reengagement context.
            const restartMode = tourModeFromTeachMode(teachModeForCallback);
            const reengage = tourReengagementContext(
                loadTourState(screen)[restartMode],
                DateTime.nowUnsafe(),
            );
            resetAllTourState();
            tourRestarted({ screenKey: screen });
            // Same viewport + mode filter as `startTour` so the
            // analytics step count matches the live `steps` list.
            const isDesktop =
                typeof window !== "undefined" &&
                window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches;
            const stepsForScreen = TOURS[screen].filter(step => {
                const v = step.viewport ?? VIEWPORT_BOTH;
                if (v === VIEWPORT_BOTH) {
                    /* viewport keep */
                } else if (v === VIEWPORT_DESKTOP && !isDesktop) return false;
                else if (v === VIEWPORT_MOBILE && isDesktop) return false;
                if (step.requiredTeachMode === undefined) return true;
                return step.requiredTeachMode === teachModeForCallback;
            });
            if (stepsForScreen.length === 0) {
                setActiveScreen(undefined);
                setStepIndex(0);
                setActiveDeltaMode(false);
                return;
            }
            TelemetryRuntime.runSync(startEffect(screen));
            tourStarted({
                screenKey: screen,
                stepCount: stepsForScreen.length,
                ...reengage,
            });
            setActiveScreen(screen);
            setStepIndex(0);
            // Manual restart = full tour, not delta — the user just
            // asked for a fresh walk.
            setActiveDeltaMode(false);
        },
        [teachModeForCallback],
    );

    // Abandon reporter: fires `tour_abandoned` if the user closes
    // the tab while the tour is open. Returns `markTerminated` so
    // the dismiss / completion paths can prevent a same-tick
    // `pagehide` from firing a redundant abandon event.
    const { markTerminated } = useTourAbandonReporter({
        activeScreen,
        stepIndex,
        currentStep,
        totalSteps,
    });

    // The original nextStep / dismissTour callbacks are wrapped so
    // they call `markTerminated` after dispatching their terminal
    // event. Wrappers don't change behavior; they just notify the
    // abandon reporter.
    const nextStepWrapped = useCallback(() => {
        const wasLastStep =
            activeScreen !== undefined &&
            steps !== undefined &&
            stepIndex >= steps.length - 1;
        nextStep();
        if (wasLastStep) markTerminated();
    }, [nextStep, activeScreen, steps, stepIndex, markTerminated]);

    const dismissTourWrapped = useCallback(
        (via: TourDismissVia) => {
            dismissTour(via);
            markTerminated();
        },
        [dismissTour, markTerminated],
    );

    // Per-step view event for the histogram funnel. Fires once per
    // (activeScreen, stepIndex) combination — one event when a tour
    // starts (step 0), one event on each Next/Back navigation. The
    // ref dedup ensures React StrictMode's double-invocation in dev
    // doesn't fire two events for the same step.
    const lastStepViewedRef = useRef<{
        screen: ScreenKey;
        index: number;
    } | null>(null);
    useEffect(() => {
        if (
            activeScreen === undefined ||
            currentStep === undefined ||
            steps === undefined
        ) {
            // Tour closed — clear the ref so the next start fires
            // step 0's event again.
            lastStepViewedRef.current = null;
            return;
        }
        const last = lastStepViewedRef.current;
        if (last?.screen === activeScreen && last.index === stepIndex) {
            return;
        }
        lastStepViewedRef.current = {
            screen: activeScreen,
            index: stepIndex,
        };
        tourStepViewed({
            screenKey: activeScreen,
            stepIndex,
            stepId: currentStep.anchor,
            totalSteps,
            isFirstStep: stepIndex === 0,
            isLastStep,
        });
    }, [activeScreen, stepIndex, currentStep, steps, totalSteps, isLastStep]);

    const value = useMemo<TourContextValue>(
        () => ({
            activeScreen,
            stepIndex,
            steps,
            currentStep,
            isLastStep,
            startTour,
            nextStep: nextStepWrapped,
            prevStep,
            dismissTour: dismissTourWrapped,
            restartTourForScreen,
        }),
        [
            activeScreen,
            stepIndex,
            steps,
            currentStep,
            isLastStep,
            startTour,
            nextStepWrapped,
            prevStep,
            dismissTourWrapped,
            restartTourForScreen,
        ],
    );

    return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
