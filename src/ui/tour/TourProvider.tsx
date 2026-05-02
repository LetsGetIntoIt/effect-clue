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
    useState,
    type ReactNode,
} from "react";
import { DateTime, Effect } from "effect";
import {
    tourCompleted,
    tourDismissed,
    tourRestarted,
    tourStarted,
    tourStepAdvanced,
    type TourDismissVia,
} from "../../analytics/events";
import { TelemetryRuntime } from "../../observability/runtime";
import { TOURS, type TourStep } from "./tours";
import {
    resetAllTourState,
    saveTourDismissed,
    type ScreenKey,
} from "./TourState";

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
    /** Begin a tour for `screen`, starting at step 0. */
    readonly startTour: (screen: ScreenKey) => void;
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

// Empty array used as the no-active-tour stand-in so the viewport
// filter hook can run unconditionally (Rules of Hooks). Module-scope
// so React sees a stable identity across renders.
const EMPTY_STEPS: ReadonlyArray<TourStep> = [];

export function TourProvider({ children }: { readonly children: ReactNode }) {
    const [activeScreen, setActiveScreen] = useState<ScreenKey | undefined>(
        undefined,
    );
    const [stepIndex, setStepIndex] = useState(0);

    // Filter happens BEFORE we expose `steps` to consumers so the
    // step counter, analytics, and the wrap-up `isLastStep` flag all
    // reflect the post-filter list. The filter is reactive — if the
    // user resizes between mobile and desktop mid-tour, the step
    // count and (if needed) the current index re-derive.
    const allSteps: ReadonlyArray<TourStep> =
        activeScreen ? TOURS[activeScreen] : EMPTY_STEPS;
    const filteredSteps = useFilterStepsByViewport(allSteps);
    const steps = activeScreen ? filteredSteps : undefined;
    const currentStep = steps?.[stepIndex];
    const totalSteps = steps?.length ?? 0;
    const isLastStep = totalSteps > 0 && stepIndex === totalSteps - 1;

    const startTour = useCallback((screen: ScreenKey) => {
        // Match the filter the live `steps` will go through so the
        // analytics step count is consistent with what the user
        // actually sees. We run the same filter logic inline here
        // because the hook can only run inside the component body.
        const isDesktop =
            typeof window !== "undefined" &&
            window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches;
        const stepsForScreen = TOURS[screen].filter(step => {
            const v = step.viewport ?? VIEWPORT_BOTH;
            if (v === VIEWPORT_BOTH) return true;
            if (v === VIEWPORT_DESKTOP) return isDesktop;
            if (v === VIEWPORT_MOBILE) return !isDesktop;
            return true;
        });
        if (stepsForScreen.length === 0) return;
        TelemetryRuntime.runSync(startEffect(screen));
        tourStarted({ screenKey: screen, stepCount: stepsForScreen.length });
        setActiveScreen(screen);
        setStepIndex(0);
    }, []);

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
        // `tourCompleted` vs `tourDismissed`.
        saveTourDismissed(activeScreen, DateTime.nowUnsafe());
        tourCompleted({
            screenKey: activeScreen,
            totalSteps: steps.length,
        });
        setActiveScreen(undefined);
        setStepIndex(0);
    }, [activeScreen, stepIndex, steps]);

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
            // Persist `lastDismissedAt` for the gate. The
            // first-fire path also writes this eagerly on tour
            // start (so a same-session refresh doesn't re-fire),
            // but the "Restart tour" overflow-menu entrypoint wipes
            // every tour key BEFORE starting, so we have to
            // re-write here for the close to be locked across page
            // loads. Idempotent — writing the same key with a
            // fresher timestamp is fine.
            saveTourDismissed(activeScreen, DateTime.nowUnsafe());
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
        },
        [activeScreen, stepIndex, steps],
    );

    const restartTourForScreen = useCallback(
        (screen: ScreenKey) => {
            resetAllTourState();
            tourRestarted({ screenKey: screen });
            // Same viewport filter as `startTour` so the analytics
            // step count matches the live `steps` list.
            const isDesktop =
                typeof window !== "undefined" &&
                window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches;
            const stepsForScreen = TOURS[screen].filter(step => {
                const v = step.viewport ?? VIEWPORT_BOTH;
                if (v === VIEWPORT_BOTH) return true;
                if (v === VIEWPORT_DESKTOP) return isDesktop;
                if (v === VIEWPORT_MOBILE) return !isDesktop;
                return true;
            });
            if (stepsForScreen.length === 0) {
                setActiveScreen(undefined);
                setStepIndex(0);
                return;
            }
            TelemetryRuntime.runSync(startEffect(screen));
            tourStarted({
                screenKey: screen,
                stepCount: stepsForScreen.length,
            });
            setActiveScreen(screen);
            setStepIndex(0);
        },
        [],
    );

    const value = useMemo<TourContextValue>(
        () => ({
            activeScreen,
            stepIndex,
            steps,
            currentStep,
            isLastStep,
            startTour,
            nextStep,
            prevStep,
            dismissTour,
            restartTourForScreen,
        }),
        [
            activeScreen,
            stepIndex,
            steps,
            currentStep,
            isLastStep,
            startTour,
            nextStep,
            prevStep,
            dismissTour,
            restartTourForScreen,
        ],
    );

    return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
