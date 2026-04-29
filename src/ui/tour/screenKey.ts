/**
 * Helper that maps the live `uiMode` to its corresponding tour
 * `ScreenKey`. Module-internal constants are intentionally module-
 * scope so the `i18next/no-literal-string` lint rule treats them as
 * non-user-copy.
 *
 * Used by `Clue.tsx`'s `TourScreenGate` (which screen's tour to
 * fire on first visit) and the "Restart tour" overflow-menu items
 * in `Toolbar.tsx` / `BottomNav.tsx` (which screen's tour to
 * re-fire after wiping the gate flags).
 */
import type { UiMode } from "../../logic/ClueState";
import type { ScreenKey } from "./TourState";

const SETUP: ScreenKey = "setup";
const SUGGEST: ScreenKey = "suggest";
const CHECKLIST: ScreenKey = "checklist";

export const screenKeyForUiMode = (mode: UiMode): ScreenKey => {
    if (mode === "setup") return SETUP;
    if (mode === "suggest") return SUGGEST;
    return CHECKLIST;
};
