/**
 * Hook that fires `tour_abandoned` when the user closes the tab /
 * navigates away while a tour is still open. Without this, dropoffs
 * by site-leave look identical to dropoffs that never started — the
 * dashboard can't tell them apart from "we never showed the tour".
 *
 * Wiring:
 *   - Caller passes the latest tour state (active screen, step
 *     index, current step, total steps).
 *   - While `activeScreen` is defined, a `pagehide` listener is
 *     installed.
 *   - When the user dismisses or completes the tour through the UI,
 *     the caller invokes `markTerminated()` so a later `pagehide`
 *     doesn't fire a redundant `tour_abandoned`. This is belt-and-
 *     suspenders: when the tour closes the cleanup also removes the
 *     listener, but `markTerminated` covers the same-tick race
 *     between firing the terminal event and React running cleanup.
 *
 * Why `pagehide` and not `beforeunload`: `pagehide` is the modern
 * recommended event, fires reliably on tab close + back-navigation
 * + browser-level navigation, and works on iOS Safari (where
 * `beforeunload` does not).
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import { tourAbandoned } from "../../analytics/events";
import type { TourStep } from "./tours";
import type { ScreenKey } from "./TourState";

interface UseTourAbandonReporterArgs {
    readonly activeScreen: ScreenKey | undefined;
    readonly stepIndex: number;
    readonly currentStep: TourStep | undefined;
    readonly totalSteps: number;
}

interface UseTourAbandonReporterApi {
    /** Mark the tour as terminated so a subsequent `pagehide` does
     *  not fire `tour_abandoned`. Call from completion / dismissal
     *  paths. */
    readonly markTerminated: () => void;
}

export function useTourAbandonReporter(
    args: UseTourAbandonReporterArgs,
): UseTourAbandonReporterApi {
    // Snapshot the latest props in a ref so the `pagehide` listener
    // — installed once when a tour starts — always reads the current
    // step index instead of a stale closure value. Only `activeScreen`
    // gates listener install/removal; everything else flows through
    // the ref.
    const stateRef = useRef(args);
    stateRef.current = args;
    const activeScreen = args.activeScreen;

    // True once the tour ended via UI (Skip / Esc / X / completion).
    // Prevents a same-tick `pagehide` from firing a redundant
    // `tour_abandoned` after the terminal UI event.
    const terminatedRef = useRef(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (activeScreen === undefined) return;
        // A new tour just started — re-arm the dedup flag so the
        // listener can fire if the user closes the tab now.
        terminatedRef.current = false;

        const onPageHide = (): void => {
            if (terminatedRef.current) return;
            const snapshot = stateRef.current;
            if (snapshot.activeScreen === undefined) return;
            if (snapshot.currentStep === undefined) return;
            terminatedRef.current = true;
            tourAbandoned({
                screenKey: snapshot.activeScreen,
                lastStepIndex: snapshot.stepIndex,
                lastStepId: snapshot.currentStep.anchor,
                totalSteps: snapshot.totalSteps,
            });
        };

        window.addEventListener("pagehide", onPageHide);
        return () => {
            window.removeEventListener("pagehide", onPageHide);
        };
        // The listener intentionally only re-installs when
        // `activeScreen` changes. Step-index updates flow through
        // the ref so we don't churn the listener every step.
    }, [activeScreen]);

    const markTerminated = useCallback((): void => {
        terminatedRef.current = true;
    }, []);

    return { markTerminated };
}
