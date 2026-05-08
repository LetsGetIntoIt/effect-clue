/**
 * Tour state-machine tests focused on the persistence-touching
 * transitions. The popover render path and analytics emission are
 * covered by `TourPopover.test.tsx` + the per-event analytics test
 * suite; this file pins the localStorage side effects that the
 * gate logic depends on.
 *
 * Specifically:
 *   - completing a tour (clicking Next on the last step) writes
 *     `lastDismissedAt` so the per-screen gate doesn't re-fire it on
 *     every page load (the gate reads "show unless
 *     dismissed-and-recent").
 *   - dismissing a tour (Skip / Esc / X) writes `lastDismissedAt`
 *     with the corresponding `via` discriminator passed through to
 *     analytics; the persisted timestamp is the same regardless of
 *     `via`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { type ReactNode } from "react";
import { DateTime } from "effect";
import { TourProvider, useTour } from "./TourProvider";
import { loadTourState, saveTourDismissed } from "./TourState";

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

const stubMatchMedia = (matches: boolean): void => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
        matches,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
};

interface TourApi {
    /** Always returns the LATEST api from the most recent render —
     * resists React's closure-staleness across re-renders. Each test
     * call site does `apiRef().dismissTour(...)` so it grabs the
     * current useCallback identity (which closes over the current
     * `activeScreen`). */
    readonly current: () => ReturnType<typeof useTour>;
}

function Probe({
    onApi,
}: {
    readonly onApi: (api: ReturnType<typeof useTour>) => void;
}): null {
    const api = useTour();
    onApi(api);
    return null;
}

function mount(children?: ReactNode): TourApi {
    let latest: ReturnType<typeof useTour> | undefined;
    render(
        <TourProvider>
            <Probe onApi={a => (latest = a)} />
            {children}
        </TourProvider>,
    );
    return {
        current: () => {
            if (!latest) throw new Error("api not yet ready");
            return latest;
        },
    };
}

beforeEach(() => {
    window.localStorage.clear();
    captureCalls.length = 0;
});

afterEach(() => {
    window.localStorage.clear();
});

describe("TourProvider — persistence on close", () => {
    test("completion: clicking Next past the last step writes lastDismissedAt", () => {
        const api = mount();
        act(() => api.current().startTour("setup"));
        // Setup has 6 steps. Click Next 6 times: steps 0→1, 1→2,
        // 2→3, 3→4, 4→5, then the 6th call past the last step
        // triggers the completion path.
        for (let i = 0; i < 6; i++) {
            act(() => api.current().nextStep());
        }
        expect(api.current().activeScreen).toBeUndefined();
        const persisted = loadTourState("setup");
        // The completion path writes lastDismissedAt so the per-screen
        // gate doesn't re-fire the tour on the next page load (the
        // gate reads "show unless dismissed-and-recent").
        expect(persisted.lastDismissedAt).toBeDefined();
    });

    test("dismissTour('skip') writes lastDismissedAt", () => {
        const api = mount();
        act(() => api.current().startTour("setup"));
        act(() => api.current().dismissTour("skip"));
        expect(api.current().activeScreen).toBeUndefined();
        const persisted = loadTourState("setup");
        expect(persisted.lastDismissedAt).toBeDefined();
    });

    test("dismissTour('esc') writes lastDismissedAt", () => {
        const api = mount();
        act(() => api.current().startTour("setup"));
        act(() => api.current().dismissTour("esc"));
        expect(api.current().activeScreen).toBeUndefined();
        const persisted = loadTourState("setup");
        expect(persisted.lastDismissedAt).toBeDefined();
    });

    test("dismissTour('close') writes lastDismissedAt", () => {
        const api = mount();
        act(() => api.current().startTour("setup"));
        act(() => api.current().dismissTour("close"));
        expect(api.current().activeScreen).toBeUndefined();
        const persisted = loadTourState("setup");
        expect(persisted.lastDismissedAt).toBeDefined();
    });

    test("completion of checklistSuggest tour writes lastDismissedAt for THAT screen only", () => {
        const api = mount();
        act(() => api.current().startTour("checklistSuggest"));
        // Walk until the tour completes. checklistSuggest's step
        // count is viewport-conditional (mobile gets one extra
        // "tap Suggest" step), so loop on `activeScreen` rather
        // than a fixed iteration count.
        let safety = 20;
        while (api.current().activeScreen !== undefined && safety-- > 0) {
            act(() => api.current().nextStep());
        }
        expect(api.current().activeScreen).toBeUndefined();
        // Per-screen isolation: only the active tour's gate is set.
        expect(loadTourState("checklistSuggest").lastDismissedAt).toBeDefined();
        expect(loadTourState("setup").lastDismissedAt).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Viewport filter — `viewport: "mobile" | "desktop"` steps are filtered
// out of the active step list per breakpoint. The step counter, the
// `tour_started` analytics step count, and `isLastStep` all reflect
// the post-filter list.
// ─────────────────────────────────────────────────────────────────────────

describe("TourProvider — viewport filter", () => {
    test("checklistSuggest exposes the same 6 steps on desktop and mobile (no viewport-locked steps post-M10)", () => {
        // M10 collapsed the older mobile-only `bottom-nav-suggest`
        // wayfinding step into the new Suggest intro step, which
        // runs on both viewports. The tour is now the same length
        // on either breakpoint.
        stubMatchMedia(true); // desktop
        const api = mount();
        act(() => api.current().startTour("checklistSuggest"));
        expect(api.current().steps?.length).toBe(6);

        stubMatchMedia(false); // mobile
        const api2 = mount();
        act(() => api2.current().startTour("checklistSuggest"));
        expect(api2.current().steps?.length).toBe(6);
    });

    test("setup tour has the same 6 steps at both breakpoints (no viewport-locked steps)", () => {
        stubMatchMedia(true);
        const api = mount();
        act(() => api.current().startTour("setup"));
        expect(api.current().steps?.length).toBe(6);

        stubMatchMedia(false);
        const api2 = mount();
        act(() => api2.current().startTour("setup"));
        expect(api2.current().steps?.length).toBe(6);
    });

    test("isLastStep is true on the final step of checklistSuggest", () => {
        stubMatchMedia(true); // desktop — 6 steps
        const api = mount();
        act(() => api.current().startTour("checklistSuggest"));
        // Step 0 of 6: not last.
        expect(api.current().isLastStep).toBe(false);
        // Walk to step 5 (the wrap-up `suggest-add-form`).
        act(() => api.current().nextStep());
        act(() => api.current().nextStep());
        act(() => api.current().nextStep());
        act(() => api.current().nextStep());
        act(() => api.current().nextStep());
        // Step 5 of 6 (0-indexed) IS the last.
        expect(api.current().isLastStep).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Analytics — generic per-step view event powers a histogram funnel that
// auto-discovers steps as tours change in code. We pin the exact event
// sequence walking through a tour so a regression in the wiring (e.g.
// dropping step-0's view event) shows up as a failing test.
// ─────────────────────────────────────────────────────────────────────────

const eventNames = (): ReadonlyArray<string> =>
    captureCalls.map(c => c.event);

describe("TourProvider — analytics events", () => {
    test("startTour fires tour_started then tour_step_viewed for step 0", () => {
        stubMatchMedia(true);
        const api = mount();
        act(() => api.current().startTour("setup"));
        expect(eventNames()).toEqual(["tour_started", "tour_step_viewed"]);
        expect(captureCalls[0]).toMatchObject({
            event: "tour_started",
            props: {
                screenKey: "setup",
                stepCount: 6,
                reengaged: false,
                daysSinceLastDismissal: null,
            },
        });
        expect(captureCalls[1]).toMatchObject({
            event: "tour_step_viewed",
            props: {
                screenKey: "setup",
                stepIndex: 0,
                stepId: "setup-card-pack",
                totalSteps: 6,
                isFirstStep: true,
                isLastStep: false,
            },
        });
    });

    test("nextStep emits tour_step_advanced then tour_step_viewed for the new step", () => {
        stubMatchMedia(true);
        const api = mount();
        act(() => api.current().startTour("setup"));
        captureCalls.length = 0; // discard start events
        act(() => api.current().nextStep());
        expect(eventNames()).toEqual([
            "tour_step_advanced",
            "tour_step_viewed",
        ]);
        expect(captureCalls[1]).toMatchObject({
            event: "tour_step_viewed",
            props: {
                screenKey: "setup",
                stepIndex: 1,
                stepId: "setup-player-column",
                isFirstStep: false,
                isLastStep: false,
            },
        });
    });

    test("completing a tour fires tour_completed (no extra step_viewed)", () => {
        stubMatchMedia(true);
        const api = mount();
        act(() => api.current().startTour("setup"));
        captureCalls.length = 0;
        for (let i = 0; i < 6; i++) {
            act(() => api.current().nextStep());
        }
        // 5 advances + 5 step_views (steps 1..5) + 1 completion.
        const last = captureCalls[captureCalls.length - 1];
        expect(last?.event).toBe("tour_completed");
        expect(last).toMatchObject({
            props: {
                screenKey: "setup",
                totalSteps: 6,
                $set: { tour_setup_status: "completed" },
            },
        });
    });

    test("dismissTour fires tour_dismissed with the via-keyed status", () => {
        stubMatchMedia(true);
        const api = mount();
        act(() => api.current().startTour("setup"));
        captureCalls.length = 0;
        act(() => api.current().dismissTour("skip"));
        expect(captureCalls).toHaveLength(1);
        expect(captureCalls[0]).toMatchObject({
            event: "tour_dismissed",
            props: {
                screenKey: "setup",
                stepIndex: 0,
                via: "skip",
                $set: {
                    tour_setup_status: "dismissed_skip",
                    last_tour_setup_step_index: 0,
                },
            },
        });
    });

    test("tour_started carries reengaged: true after a previous dismissal", () => {
        stubMatchMedia(true);
        // Pre-seed a dismissal so loadTourState reports lastDismissedAt.
        saveTourDismissed("setup", DateTime.nowUnsafe());
        const api = mount();
        act(() => api.current().startTour("setup"));
        expect(captureCalls[0]).toMatchObject({
            event: "tour_started",
            props: { screenKey: "setup", reengaged: true },
        });
        expect(captureCalls[0]?.props).toHaveProperty(
            "daysSinceLastDismissal",
            0,
        );
    });

    test("restartTourForScreen reports reengaged from BEFORE wiping state", () => {
        stubMatchMedia(true);
        saveTourDismissed("setup", DateTime.nowUnsafe());
        const api = mount();
        act(() => api.current().restartTourForScreen("setup"));
        const startedEvent = captureCalls.find(c => c.event === "tour_started");
        expect(startedEvent).toMatchObject({
            props: { screenKey: "setup", reengaged: true },
        });
    });
});
