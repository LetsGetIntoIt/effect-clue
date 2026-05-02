/**
 * Round-trip tests for the uiMode ↔ ScreenKey mapping. Both halves
 * are pure and synchronous; the tests pin the mapping so a future
 * refactor can't silently introduce a uiMode that has no tour
 * `ScreenKey` (or a `ScreenKey` that maps to the wrong uiMode and
 * thereby breaks `StartupCoordinator`'s precedence redirect).
 */
import { describe, expect, test } from "vitest";
import { screenKeyForUiMode, uiModeForScreenKey } from "./screenKey";
import type { ScreenKey } from "./TourState";
import type { UiMode } from "../../logic/ClueState";

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
