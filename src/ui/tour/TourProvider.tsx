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
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { Effect } from "effect";
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

export function TourProvider({ children }: { readonly children: ReactNode }) {
    const [activeScreen, setActiveScreen] = useState<ScreenKey | undefined>(
        undefined,
    );
    const [stepIndex, setStepIndex] = useState(0);

    const steps = activeScreen ? TOURS[activeScreen] : undefined;
    const currentStep = steps?.[stepIndex];
    const totalSteps = steps?.length ?? 0;
    const isLastStep = totalSteps > 0 && stepIndex === totalSteps - 1;

    const startTour = useCallback((screen: ScreenKey) => {
        const stepsForScreen = TOURS[screen];
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
        // Past the last step — completion path.
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
            const stepsForScreen = TOURS[screen];
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
