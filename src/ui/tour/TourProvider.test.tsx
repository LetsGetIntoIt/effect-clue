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
import { TourProvider, useTour } from "./TourProvider";
import { loadTourState } from "./TourState";

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
    test("checklistSuggest exposes 4 steps on desktop (mobile-only step filtered)", () => {
        stubMatchMedia(true); // desktop
        const api = mount();
        act(() => api.current().startTour("checklistSuggest"));
        expect(api.current().steps?.length).toBe(4);
        // The mobile-only `bottom-nav-suggest` step is excluded.
        expect(
            api.current().steps?.map(s => s.anchor),
        ).not.toContain("bottom-nav-suggest");
    });

    test("checklistSuggest exposes 5 steps on mobile (mobile-only step included)", () => {
        stubMatchMedia(false); // mobile
        const api = mount();
        act(() => api.current().startTour("checklistSuggest"));
        expect(api.current().steps?.length).toBe(5);
        expect(
            api.current().steps?.map(s => s.anchor),
        ).toContain("bottom-nav-suggest");
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

    test("isLastStep is computed from the post-filter list", () => {
        stubMatchMedia(true); // desktop — 4 steps
        const api = mount();
        act(() => api.current().startTour("checklistSuggest"));
        // Step 0 of 4: not last.
        expect(api.current().isLastStep).toBe(false);
        // Walk to step 3 (the wrap-up `suggest-add-form`).
        act(() => api.current().nextStep());
        act(() => api.current().nextStep());
        act(() => api.current().nextStep());
        // Step 3 of 4 (0-indexed) IS the last on desktop.
        expect(api.current().isLastStep).toBe(true);
        // Without the filter, step 3 would be the mobile-only
        // `bottom-nav-suggest` and isLastStep would be false at this
        // point — pinning isLastStep at desktop step 3 confirms the
        // filter is wiring through.
    });
});
