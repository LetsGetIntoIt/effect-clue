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
    vi,
} from "vitest";
import { act, render } from "@testing-library/react";
import {
    StartupCoordinatorProvider,
    useStartupCoordinator,
} from "./StartupCoordinator";
import type { ScreenKey } from "../tour/TourState";

const STORAGE_SPLASH = "effect-clue.splash.v1";
const STORAGE_TOUR_SETUP = "effect-clue.tour.setup.v1";
const STORAGE_TOUR_CHECKLIST_SUGGEST = "effect-clue.tour.checklistSuggest.v1";
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
    // Seed BOTH per-screen tour gates so the precedence sweep across
    // [setup, checklistSuggest] doesn't pick up an unseeded screen as
    // eligible. With precedence enabled, leaving any screen unseeded
    // (i.e. no localStorage entry) makes the coordinator treat that
    // tour as "fresh, never seen" → eligible.
    seed(STORAGE_TOUR_SETUP, {
        version: 1,
        lastVisitedAt: recent,
        lastDismissedAt: recent,
    });
    seed(STORAGE_TOUR_CHECKLIST_SUGGEST, {
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
    onRedirectToScreen?: (screen: ScreenKey) => void,
): { rerender: (nextScreen: ScreenKey) => void } => {
    // Conditional-spread the redirect callback so TypeScript's
    // `exactOptionalPropertyTypes` doesn't reject `undefined`. Tests
    // that omit the callback exercise the fallback (no redirect).
    const redirectProp = onRedirectToScreen
        ? { onRedirectToScreen }
        : {};
    const Wrapped = ({ screen }: { screen: ScreenKey }) => (
        <StartupCoordinatorProvider
            hydrated
            activeScreen={screen}
            {...redirectProp}
        >
            <Probe />
        </StartupCoordinatorProvider>
    );
    const utils = render(<Wrapped screen={activeScreen} />);
    return {
        rerender: nextScreen => utils.rerender(<Wrapped screen={nextScreen} />),
    };
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
        const recent = new Date().toISOString();
        seed(STORAGE_SPLASH, { version: 1 });
        seed(STORAGE_TOUR_SETUP, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        seed(STORAGE_TOUR_CHECKLIST_SUGGEST, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
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
        seed(STORAGE_TOUR_CHECKLIST_SUGGEST, {
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
        seed(STORAGE_TOUR_CHECKLIST_SUGGEST, {
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

// ─────────────────────────────────────────────────────────────────────────
// Round-4: tour precedence. The coordinator picks the highest-priority
// eligible tour across all per-screen gates and asks the parent to
// redirect (via `onRedirectToScreen`) when the user landed on a
// different screen. Today's precedence list: [setup, checklistSuggest].
// ─────────────────────────────────────────────────────────────────────────

describe("StartupCoordinator — tour precedence", () => {
    test("brand-new user lands on checklistSuggest → redirect to setup", () => {
        // Setup tour eligible (no localStorage entry → first visit).
        // checklistSuggest also eligible. User landed on
        // `checklistSuggest`. Setup wins precedence; coordinator asks
        // parent to redirect.
        const recent = new Date().toISOString();
        seed(STORAGE_SPLASH, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        seed(STORAGE_INSTALL, { version: 1, visits: 0 });
        // No tour state seeded → both tours are eligible.

        const onRedirect = vi.fn();
        const harness = mount("checklistSuggest", onRedirect);
        // Coordinator dispatched the redirect — phase stays at boot
        // pending the parent's setUiMode + re-render with the new
        // screen.
        expect(onRedirect).toHaveBeenCalledWith("setup");
        expect(probe.current?.phase).toBe("boot");
        // Parent dispatches setUiMode("setup") → activeScreen prop
        // updates → effect re-runs and snapshots eligibility.
        act(() => harness.rerender("setup"));
        expect(probe.current?.phase).toBe("tour");
    });

    test("brand-new user already on setup → no redirect", () => {
        const recent = new Date().toISOString();
        seed(STORAGE_SPLASH, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        seed(STORAGE_INSTALL, { version: 1, visits: 0 });

        const onRedirect = vi.fn();
        mount("setup", onRedirect);
        expect(onRedirect).not.toHaveBeenCalled();
        expect(probe.current?.phase).toBe("tour");
    });

    test("returning user (setup completed) on checklistSuggest → no redirect", () => {
        // Setup completed (lastDismissedAt set). checklistSuggest
        // eligible. Precedence walks setup first (skipped, not
        // eligible) then checklistSuggest (eligible, matches the
        // user's current screen) → no redirect, tour fires.
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

        const onRedirect = vi.fn();
        mount("checklistSuggest", onRedirect);
        expect(onRedirect).not.toHaveBeenCalled();
        expect(probe.current?.phase).toBe("tour");
    });

    test("no tours eligible → no redirect; phase advances past tour", () => {
        // All tours dismissed. Coordinator finds no eligible target;
        // no redirect. Tour eligibility = false; phase falls through
        // to install (eligible) per the priority order.
        dismissedAtAllGates();
        // Re-seed install as eligible.
        seed(STORAGE_INSTALL, { version: 1, visits: 1 });

        const onRedirect = vi.fn();
        mount("checklistSuggest", onRedirect);
        expect(onRedirect).not.toHaveBeenCalled();
        expect(probe.current?.phase).toBe("install");
    });

    test("splash-eligible boot defers precedence to splash close", () => {
        // Splash + setup both eligible; user is on checklistSuggest.
        // The redirect should NOT fire while splash is on screen.
        // After splash close, the redirect fires.
        seed(STORAGE_SPLASH, { version: 1 }); // eligible
        seed(STORAGE_INSTALL, { version: 1, visits: 0 });

        const onRedirect = vi.fn();
        const harness = mount("checklistSuggest", onRedirect);
        // Splash phase first; no redirect yet.
        expect(probe.current?.phase).toBe("splash");
        expect(onRedirect).not.toHaveBeenCalled();
        // Close splash → coordinator re-runs precedence.
        act(() => probe.current?.reportClosed("splash"));
        expect(onRedirect).toHaveBeenCalledWith("setup");
        // Phase advances to tour optimistically (the redirect dispatch
        // will land + re-render with the new screen, where the
        // matching tour fires).
        expect(probe.current?.phase).toBe("tour");
        // Parent dispatches the redirect; activeScreen prop updates.
        act(() => harness.rerender("setup"));
        // Phase stays on tour (snapshot already set; no re-decision).
        expect(probe.current?.phase).toBe("tour");
    });

    test("when no onRedirectToScreen is provided, falls back to single-screen eligibility", () => {
        // Defensive: if a caller doesn't supply the callback, the
        // coordinator behaves as it did before precedence — checks
        // ONLY the active screen's eligibility.
        const recent = new Date().toISOString();
        seed(STORAGE_SPLASH, {
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        });
        // Setup eligible; user on checklistSuggest with that screen
        // also eligible (precedence WOULD redirect to setup, but
        // without the callback, no redirect).
        seed(STORAGE_INSTALL, { version: 1, visits: 0 });

        // Redirect callback explicitly OMITTED.
        mount("checklistSuggest");
        // Tour fires — but for the user's CURRENT screen, not setup.
        // We can't directly assert which tour fires from here (the
        // tour content is owned by `TourScreenGate`/`TourProvider`),
        // but phase=tour confirms the coordinator decided to fire.
        expect(probe.current?.phase).toBe("tour");
    });
});
