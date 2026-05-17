/**
 * Round-trip tests for the uiMode ↔ ScreenKey mapping. Both halves
 * are pure and synchronous; the tests pin the mapping so a future
 * refactor can't silently introduce a uiMode that has no tour
 * `ScreenKey` (or a `ScreenKey` that maps to the wrong uiMode and
 * thereby breaks `StartupCoordinator`'s precedence redirect).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DateTime } from "effect";
import {
    pickFirstEligibleScreenKey,
    screenKeyForUiMode,
    screensForUiMode,
    uiModeForScreenKey,
} from "./screenKey";
import type { ScreenKey } from "./TourState";
import type { UiMode } from "../../logic/ClueState";

const STORAGE_TOUR_SETUP = "effect-clue.tour.setup.v1";
const STORAGE_TOUR_CHECKLIST_SUGGEST = "effect-clue.tour.checklistSuggest.v1";
const STORAGE_TOUR_SHARING = "effect-clue.tour.sharing.v1";

const seedDismissed = (key: string): void => {
    const recent = new Date().toISOString();
    window.localStorage.setItem(
        key,
        JSON.stringify({
            version: 2,
            normal: {
                lastVisitedAt: recent,
                lastDismissedAt: recent,
            },
        }),
    );
};

const seedDismissedOnly = (key: string, recent: string): void => {
    window.localStorage.setItem(
        key,
        JSON.stringify({
            version: 2,
            normal: {
                lastDismissedAt: recent,
            },
        }),
    );
};

describe("screenKeyForUiMode", () => {
    test("setup uiMode → setup screen", () => {
        expect(screenKeyForUiMode("setup")).toBe("setup");
    });

    test("checklist uiMode → checklistSuggest screen (combined tour)", () => {
        expect(screenKeyForUiMode("checklist")).toBe("checklistSuggest");
    });

    test("suggest uiMode → checklistSuggest screen (combined tour)", () => {
        expect(screenKeyForUiMode("suggest")).toBe("checklistSuggest");
    });
});

describe("uiModeForScreenKey", () => {
    test("setup screen → setup uiMode (canonical)", () => {
        expect(uiModeForScreenKey("setup")).toBe("setup");
    });

    test("sharing screen → setup uiMode (follow-up tour fires on the setup pane)", () => {
        expect(uiModeForScreenKey("sharing")).toBe("setup");
    });

    test("checklistSuggest screen → checklist uiMode (canonical)", () => {
        // The combined tour starts on the checklist pane on mobile;
        // `checklist` is the default of the two share-a-tour modes.
        expect(uiModeForScreenKey("checklistSuggest")).toBe("checklist");
    });

    test("firstSuggestion screen → undefined (event-triggered, not screen-mounted)", () => {
        expect(uiModeForScreenKey("firstSuggestion")).toBeUndefined();
    });

    test("account screen → undefined (reserved overlay)", () => {
        expect(uiModeForScreenKey("account")).toBeUndefined();
    });

    test("shareImport screen → undefined (reserved overlay)", () => {
        expect(uiModeForScreenKey("shareImport")).toBeUndefined();
    });
});

describe("uiMode ↔ ScreenKey round-trip", () => {
    // For every uiMode the user can be in, dispatching to its
    // corresponding screen and back lands on a uiMode that
    // `screenKeyForUiMode` maps to the same screen. This is what
    // makes the precedence redirect idempotent — once redirected to
    // the canonical uiMode, the next render's screenKey matches.
    const uiModes: ReadonlyArray<UiMode> = ["setup", "checklist", "suggest"];
    for (const mode of uiModes) {
        test(`${mode}: round-trip stays on the same screen`, () => {
            const screen = screenKeyForUiMode(mode);
            const canonicalMode = uiModeForScreenKey(screen);
            expect(canonicalMode).toBeDefined();
            expect(screenKeyForUiMode(canonicalMode!)).toBe(screen);
        });
    }

    // The reverse direction: every screen with a uiMode maps back to
    // its own ScreenKey via screenKeyForUiMode. (Screens without a
    // uiMode return undefined and are excluded — they're event-fired
    // overlays, never landing-screen tours.)
    const mappedScreens: ReadonlyArray<ScreenKey> = [
        "setup",
        "checklistSuggest",
    ];
    for (const screen of mappedScreens) {
        test(`${screen}: canonical uiMode maps back to itself`, () => {
            const mode = uiModeForScreenKey(screen);
            expect(mode).toBeDefined();
            expect(screenKeyForUiMode(mode!)).toBe(screen);
        });
    }
});

describe("screensForUiMode", () => {
    test("setup uiMode lists [setup, sharing] in priority order", () => {
        // The foundational `setup` tour fires first; `sharing` is the
        // follow-up that picks up after both setup + checklistSuggest
        // have been dismissed.
        expect(screensForUiMode("setup")).toEqual(["setup", "sharing"]);
    });

    test("checklist uiMode lists only [checklistSuggest]", () => {
        expect(screensForUiMode("checklist")).toEqual(["checklistSuggest"]);
    });

    test("suggest uiMode lists only [checklistSuggest]", () => {
        expect(screensForUiMode("suggest")).toEqual(["checklistSuggest"]);
    });
});

describe("pickFirstEligibleScreenKey", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    const now = DateTime.makeUnsafe(new Date(0));

    test("brand-new user on setup → picks setup (no localStorage at all)", () => {
        expect(pickFirstEligibleScreenKey(["setup", "sharing"], "normal", now)).toBe(
            "setup",
        );
    });

    test("setup tour dismissed but checklistSuggest not → sharing prereqs unmet → falls back to setup", () => {
        // setup dismissed, but checklistSuggest never seen. Sharing's
        // prereq list is ["setup", "checklistSuggest"] — both must be
        // dismissed. Only one is. Sharing is ineligible. Setup itself
        // is dismissed-and-recent so its own gate also fails. The
        // helper falls back to the first candidate ("setup") so the
        // gate hook runs against a stable key (and decides not to
        // show).
        seedDismissed(STORAGE_TOUR_SETUP);
        expect(pickFirstEligibleScreenKey(["setup", "sharing"], "normal", now)).toBe(
            "setup",
        );
    });

    test("both prereqs dismissed → sharing eligible → returns sharing", () => {
        seedDismissed(STORAGE_TOUR_SETUP);
        seedDismissed(STORAGE_TOUR_CHECKLIST_SUGGEST);
        expect(pickFirstEligibleScreenKey(["setup", "sharing"], "normal", now)).toBe(
            "sharing",
        );
    });

    test("dismissed-only setup state stays suppressed inside the re-engage window", () => {
        const recent = new Date(DateTime.toEpochMillis(now)).toISOString();
        seedDismissedOnly(STORAGE_TOUR_SETUP, recent);
        seedDismissed(STORAGE_TOUR_CHECKLIST_SUGGEST);
        expect(pickFirstEligibleScreenKey(["setup", "sharing"], "normal", now)).toBe(
            "sharing",
        );
    });

    test("both prereqs + sharing all dismissed-recently → fallback to first candidate", () => {
        seedDismissed(STORAGE_TOUR_SETUP);
        seedDismissed(STORAGE_TOUR_CHECKLIST_SUGGEST);
        seedDismissed(STORAGE_TOUR_SHARING);
        // No tour eligible; helper returns the first candidate so the
        // gate signature stays stable.
        expect(pickFirstEligibleScreenKey(["setup", "sharing"], "normal", now)).toBe(
            "setup",
        );
    });

    test("checklist uiMode → only checklistSuggest is in the list, picks it", () => {
        // Even with sharing's prereqs dismissed, the checklist uiMode's
        // candidate list doesn't include sharing — so sharing never
        // fires here.
        seedDismissed(STORAGE_TOUR_SETUP);
        seedDismissed(STORAGE_TOUR_CHECKLIST_SUGGEST);
        expect(
            pickFirstEligibleScreenKey(["checklistSuggest"], "normal", now),
        ).toBe("checklistSuggest");
    });

    test("teach mode is independent: normal-mode dismissal doesn't suppress the teach-mode tour", () => {
        // Even with both the setup and checklistSuggest tours dismissed
        // in normal mode, a user who hasn't seen the teach-mode tours
        // should still get them when their gate is read for `teach`.
        seedDismissed(STORAGE_TOUR_SETUP);
        seedDismissed(STORAGE_TOUR_CHECKLIST_SUGGEST);
        expect(
            pickFirstEligibleScreenKey(["checklistSuggest"], "teach", now),
        ).toBe("checklistSuggest");
    });

    test("teach mode: sharing's prereqs satisfied by EITHER mode's dismissal", () => {
        // Prerequisite check is mode-agnostic — a user who walked
        // through setup + checklistSuggest in normal mode shouldn't
        // be blocked from sharing in teach mode. Setup itself needs
        // to be dismissed in teach mode too so it's not the first
        // eligible candidate.
        const recent = new Date(DateTime.toEpochMillis(now)).toISOString();
        window.localStorage.setItem(
            STORAGE_TOUR_SETUP,
            JSON.stringify({
                version: 2,
                normal: { lastVisitedAt: recent, lastDismissedAt: recent },
                teach: { lastVisitedAt: recent, lastDismissedAt: recent },
            }),
        );
        seedDismissed(STORAGE_TOUR_CHECKLIST_SUGGEST);
        expect(
            pickFirstEligibleScreenKey(["setup", "sharing"], "teach", now),
        ).toBe("sharing");
    });
});
