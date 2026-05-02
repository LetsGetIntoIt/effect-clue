/**
 * Tests for the tour-abandonment reporter. Pins:
 *   - `pagehide` while a tour is active fires `tour_abandoned` with
 *     the latest step index.
 *   - `markTerminated()` (called from completion / dismissal paths)
 *     suppresses the abandon event for the rest of the page load.
 *   - When `activeScreen` flips to `undefined`, the listener is
 *     removed (no abandon event after the tour closes).
 *   - The listener reads the LATEST step index (ref pattern) — a
 *     mid-tour `pagehide` reports the user's actual step, not the
 *     one they started on.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { useTourAbandonReporter } from "./useTourAbandonReporter";
import type { ScreenKey } from "./TourState";
import type { TourStep } from "./tours";

const captureCalls: Array<{
    event: string;
    props: Record<string, unknown> | undefined;
}> = [];

vi.mock("../../analytics/posthog", () => ({
    posthog: {
        __loaded: true,
        capture: (event: string, props?: Record<string, unknown>) => {
            captureCalls.push({ event, props });
        },
    },
}));

afterEach(() => {
    captureCalls.length = 0;
});

const stepFromAnchor = (anchor: string): TourStep => ({
    anchor,
    titleKey: "x",
});

interface ProbeProps {
    readonly activeScreen: ScreenKey | undefined;
    readonly stepIndex: number;
    readonly currentStep: TourStep | undefined;
    readonly totalSteps: number;
    readonly onApi?: (
        api: ReturnType<typeof useTourAbandonReporter>,
    ) => void;
}

function Probe({
    activeScreen,
    stepIndex,
    currentStep,
    totalSteps,
    onApi,
}: ProbeProps): null {
    const api = useTourAbandonReporter({
        activeScreen,
        stepIndex,
        currentStep,
        totalSteps,
    });
    onApi?.(api);
    return null;
}

const firePageHide = (): void => {
    window.dispatchEvent(new Event("pagehide"));
};

describe("useTourAbandonReporter", () => {
    test("does nothing when no tour is active", () => {
        render(
            <Probe
                activeScreen={undefined}
                stepIndex={0}
                currentStep={undefined}
                totalSteps={0}
            />,
        );
        firePageHide();
        expect(captureCalls).toEqual([]);
    });

    test("fires tour_abandoned when pagehide fires mid-tour", () => {
        render(
            <Probe
                activeScreen="setup"
                stepIndex={2}
                currentStep={stepFromAnchor("setup-known-cell")}
                totalSteps={6}
            />,
        );
        firePageHide();
        expect(captureCalls).toHaveLength(1);
        expect(captureCalls[0]).toMatchObject({
            event: "tour_abandoned",
            props: {
                screenKey: "setup",
                lastStepIndex: 2,
                lastStepId: "setup-known-cell",
                totalSteps: 6,
            },
        });
    });

    test("does not fire after markTerminated() is called", () => {
        let api: ReturnType<typeof useTourAbandonReporter> | undefined;
        render(
            <Probe
                activeScreen="setup"
                stepIndex={3}
                currentStep={stepFromAnchor("overflow-menu")}
                totalSteps={6}
                onApi={a => (api = a)}
            />,
        );
        api!.markTerminated();
        firePageHide();
        expect(captureCalls).toEqual([]);
    });

    test("does not fire after the tour closes (activeScreen=undefined)", () => {
        const { rerender } = render(
            <Probe
                activeScreen="setup"
                stepIndex={1}
                currentStep={stepFromAnchor("setup-player-column")}
                totalSteps={6}
            />,
        );
        rerender(
            <Probe
                activeScreen={undefined}
                stepIndex={0}
                currentStep={undefined}
                totalSteps={0}
            />,
        );
        firePageHide();
        expect(captureCalls).toEqual([]);
    });

    test("reads the latest step index, not the one at mount time", () => {
        const { rerender } = render(
            <Probe
                activeScreen="checklistSuggest"
                stepIndex={0}
                currentStep={stepFromAnchor("checklist-cell")}
                totalSteps={4}
            />,
        );
        rerender(
            <Probe
                activeScreen="checklistSuggest"
                stepIndex={3}
                currentStep={stepFromAnchor("suggest-add-form")}
                totalSteps={4}
            />,
        );
        firePageHide();
        expect(captureCalls).toHaveLength(1);
        expect(captureCalls[0]?.props).toMatchObject({
            screenKey: "checklistSuggest",
            lastStepIndex: 3,
            lastStepId: "suggest-add-form",
            totalSteps: 4,
        });
    });

    test("fires only once even if pagehide repeats", () => {
        render(
            <Probe
                activeScreen="setup"
                stepIndex={0}
                currentStep={stepFromAnchor("setup-card-pack")}
                totalSteps={6}
            />,
        );
        firePageHide();
        firePageHide();
        firePageHide();
        expect(captureCalls).toHaveLength(1);
    });
});
