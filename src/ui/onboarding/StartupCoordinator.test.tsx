/**
 * Pins the priority + suppression rules for the page-load coordinator.
 *
 * Browser-side modal interaction is tested by the per-modal test
 * files (`SplashModal.test.tsx`, `InstallPromptModal.test.tsx`,
 * `TourPopover.test.tsx`). This file targets the coordinator's
 * decision logic directly: which slot gets to fire first, what
 * happens when each slot's modal closes, and the install-after-tour
 * suppression rule.
 */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";
import { act, render } from "@testing-library/react";
import {
    StartupCoordinatorProvider,
    useStartupCoordinator,
} from "./StartupCoordinator";

const STORAGE_SPLASH = "effect-clue.splash.v1";
const STORAGE_TOUR_SETUP = "effect-clue.tour.setup.v1";
const STORAGE_INSTALL = "effect-clue.install-prompt.v1";

const seed = (key: string, value: object): void => {
    window.localStorage.setItem(key, JSON.stringify(value));
};

const eligibleAtAllGates = (): void => {
    // Splash: no `lastDismissedAt` → first-visit branch fires.
    seed(STORAGE_SPLASH, { version: 1 });
    // Tour: same — no dismiss timestamp → fires on first visit.
    seed(STORAGE_TOUR_SETUP, { version: 1 });
    // Install: visits at 1 → bumped to 2 by the gate hook (matching
    // production behaviour). 2 ≥ MIN_VISITS, no `lastDismissedAt` →
    // eligible.
    seed(STORAGE_INSTALL, { version: 1, visits: 1 });
};

const dismissedAtAllGates = (): void => {
    const recent = new Date().toISOString();
    seed(STORAGE_SPLASH, {
        version: 1,
        lastVisitedAt: recent,
        lastDismissedAt: recent,
    });
    seed(STORAGE_TOUR_SETUP, {
        version: 1,
        lastVisitedAt: recent,
        lastDismissedAt: recent,
    });
    seed(STORAGE_INSTALL, { version: 1, visits: 0 });
};

interface ProbeState {
    phase: string;
    reportClosed: (slot: "splash" | "tour" | "install") => void;
}

const probe: { current: ProbeState | null } = { current: null };

function Probe() {
    const ctx = useStartupCoordinator();
    probe.current = ctx;
    return null;
}

const mount = (
    activeScreen: "setup" | "checklistSuggest" = "setup",
): void => {
    render(
        <StartupCoordinatorProvider hydrated activeScreen={activeScreen}>
            <Probe />
        </StartupCoordinatorProvider>,
    );
};

beforeEach(() => {
    window.localStorage.clear();
    probe.current = null;
});

afterEach(() => {
    window.localStorage.clear();
});

describe("StartupCoordinator — priority order", () => {
    test("nothing eligible → phase advances straight to done", () => {
        dismissedAtAllGates();
        mount();
        expect(probe.current?.phase).toBe("done");
    });

    test("only splash eligible → phase becomes splash, then done after dismiss", () => {
        seed(STORAGE_SPLASH, { version: 1 });
        seed(STORAGE_TOUR_SETUP, {
            version: 1,
            lastVisitedAt: new Date().toISOString(),
            lastDismissedAt: new Date().toISOString(),
        });
        seed(STORAGE_INSTALL, { version: 1, visits: 0 });
        mount();
        expect(probe.current?.phase).toBe("splash");
        act(() => probe.current?.reportClosed("splash"));
        expect(probe.current?.phase).toBe("done");
    });

    test("only tour eligible → phase becomes tour directly", () => {
        const recent = new Date().toISOString();
        seed(STORAGE_SPLASH, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        seed(STORAGE_TOUR_SETUP, { version: 1 });
        seed(STORAGE_INSTALL, { version: 1, visits: 0 });
        mount();
        expect(probe.current?.phase).toBe("tour");
    });

    test("only install eligible → phase becomes install directly", () => {
        const recent = new Date().toISOString();
        seed(STORAGE_SPLASH, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        seed(STORAGE_TOUR_SETUP, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        seed(STORAGE_INSTALL, { version: 1, visits: 1 });
        mount();
        expect(probe.current?.phase).toBe("install");
    });

    test("all eligible → splash fires first; tour follows after splash dismiss", () => {
        eligibleAtAllGates();
        mount();
        expect(probe.current?.phase).toBe("splash");
        act(() => probe.current?.reportClosed("splash"));
        expect(probe.current?.phase).toBe("tour");
    });
});

describe("StartupCoordinator — tour suppresses install", () => {
    test("after a tour fires + closes, install does NOT fire", () => {
        eligibleAtAllGates();
        mount();
        expect(probe.current?.phase).toBe("splash");
        // Splash → tour
        act(() => probe.current?.reportClosed("splash"));
        expect(probe.current?.phase).toBe("tour");
        // Tour close → done (NOT install, even though install gate
        // is otherwise eligible).
        act(() => probe.current?.reportClosed("tour"));
        expect(probe.current?.phase).toBe("done");
    });

    test("when only tour + install are eligible, tour fires and install is suppressed", () => {
        const recent = new Date().toISOString();
        seed(STORAGE_SPLASH, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        seed(STORAGE_TOUR_SETUP, { version: 1 });
        seed(STORAGE_INSTALL, { version: 1, visits: 1 });
        mount();
        expect(probe.current?.phase).toBe("tour");
        act(() => probe.current?.reportClosed("tour"));
        expect(probe.current?.phase).toBe("done");
    });

    test("when splash + install are eligible (tour dismissed), install fires after splash", () => {
        const recent = new Date().toISOString();
        seed(STORAGE_SPLASH, { version: 1 }); // eligible
        seed(STORAGE_TOUR_SETUP, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        seed(STORAGE_INSTALL, { version: 1, visits: 1 });
        mount();
        expect(probe.current?.phase).toBe("splash");
        act(() => probe.current?.reportClosed("splash"));
        expect(probe.current?.phase).toBe("install");
        act(() => probe.current?.reportClosed("install"));
        expect(probe.current?.phase).toBe("done");
    });
});

describe("StartupCoordinator — defensive transitions", () => {
    test("reportClosed for a non-active slot is a no-op", () => {
        eligibleAtAllGates();
        mount();
        expect(probe.current?.phase).toBe("splash");
        // Calling reportClosed("install") while phase is "splash"
        // should NOT advance — this defends against double-close
        // races (e.g. install snooze + close fired in the same
        // commit).
        act(() => probe.current?.reportClosed("install"));
        expect(probe.current?.phase).toBe("splash");
        act(() => probe.current?.reportClosed("tour"));
        expect(probe.current?.phase).toBe("splash");
    });

    test("active-screen tour eligibility is what matters", () => {
        // Suggest screen lands on the combined `checklistSuggest` tour.
        const recent = new Date().toISOString();
        seed(STORAGE_SPLASH, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        // Setup tour is dismissed but checklistSuggest is fresh.
        seed(STORAGE_TOUR_SETUP, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        seed("effect-clue.tour.checklistSuggest.v1", { version: 1 });
        seed(STORAGE_INSTALL, { version: 1, visits: 0 });
        mount("checklistSuggest");
        expect(probe.current?.phase).toBe("tour");
    });
});
