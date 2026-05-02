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
const CHECKLIST_SUGGEST: ScreenKey = "checklistSuggest";

/** Module-scope `uiMode` discriminators. The `i18next/no-literal-string`
 * lint rule treats inline string literals as user-facing copy; pulling
 * these out keeps it quiet without per-call eslint-disable. */
const UI_MODE_SETUP: UiMode = "setup";
const UI_MODE_CHECKLIST: UiMode = "checklist";

/**
 * Map the live `uiMode` to its corresponding tour `ScreenKey`. Both
 * `checklist` and `suggest` modes share the combined
 * `checklistSuggest` tour — the tour driver dispatches between
 * panes on mobile when individual steps require it.
 */
export const screenKeyForUiMode = (mode: UiMode): ScreenKey => {
    if (mode === UI_MODE_SETUP) return SETUP;
    return CHECKLIST_SUGGEST;
};

/**
 * Inverse of `screenKeyForUiMode`: the canonical `uiMode` to land on
 * for a given tour `ScreenKey`. Used by `StartupCoordinator`'s
 * precedence redirect to bring a brand-new user to the screen whose
 * tour should fire first (e.g. someone who lands on `/play?view=
 * checklist` gets dispatched to `setup` so the setup tour fires
 * before the checklist tour).
 *
 * Returns `undefined` for screens that don't correspond to a uiMode:
 *   - `firstSuggestion` is event-triggered (after the user logs their
 *     first suggestion), not screen-mounted.
 *   - `account` and `shareImport` are reserved for M7 / M9 — they
 *     overlay any uiMode rather than redirect.
 */
export const uiModeForScreenKey = (screen: ScreenKey): UiMode | undefined => {
    if (screen === SETUP) return UI_MODE_SETUP;
    if (screen === CHECKLIST_SUGGEST) return UI_MODE_CHECKLIST;
    return undefined;
};
