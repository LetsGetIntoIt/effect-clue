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
import { DateTime, Duration } from "effect";
import type { UiMode } from "../../logic/ClueState";
import { TOUR_PREREQUISITES, TOUR_RE_ENGAGE_DURATION } from "./tours";
import { loadTourState, type ScreenKey } from "./TourState";

const SETUP: ScreenKey = "setup";
const CHECKLIST_SUGGEST: ScreenKey = "checklistSuggest";
const SHARING: ScreenKey = "sharing";

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
    if (screen === SHARING) return UI_MODE_SETUP;
    return undefined;
};

/**
 * Priority-ordered list of tour `ScreenKey`s that fire on a given
 * `uiMode`. Most modes have a single tour; `setup` has both the
 * foundational `setup` tour and the follow-up `sharing` tour, in
 * that order.
 *
 * `TourScreenGate` walks this list and gates the FIRST tour whose
 * prerequisites are met AND whose own re-engage gate says "show". A
 * mode with no eligible tour returns its primary tour anyway so the
 * gate machinery still runs (and just decides not to show).
 */
export const screensForUiMode = (mode: UiMode): ReadonlyArray<ScreenKey> => {
    if (mode === UI_MODE_SETUP) return [SETUP, SHARING];
    return [CHECKLIST_SUGGEST];
};

/**
 * Pick the first `ScreenKey` from `candidates` that's actually eligible
 * to fire right now: every prerequisite tour has been dismissed, AND
 * the candidate's own re-engage gate is open (never dismissed, OR
 * dismissed and the dormancy window has elapsed).
 *
 * Returns the first candidate when nothing is eligible — keeps the
 * call site's hook signature stable; the per-screen gate hook will
 * decide not to show anyway.
 *
 * Pure read of localStorage via `loadTourState`; no side effects.
 */
export const pickFirstEligibleScreenKey = (
    candidates: ReadonlyArray<ScreenKey>,
    now: DateTime.Utc,
): ScreenKey => {
    for (const candidate of candidates) {
        const prereqs = TOUR_PREREQUISITES[candidate] ?? [];
        const prereqsAllDismissed = prereqs.every(
            (p) => loadTourState(p).lastDismissedAt !== undefined,
        );
        if (!prereqsAllDismissed) continue;
        const state = loadTourState(candidate);
        if (state.lastDismissedAt === undefined) return candidate;
        if (state.lastVisitedAt === undefined) return candidate;
        const elapsed = DateTime.distance(state.lastVisitedAt, now);
        if (Duration.isGreaterThan(elapsed, TOUR_RE_ENGAGE_DURATION)) {
            return candidate;
        }
    }
    // None eligible — return the first candidate (the primary tour for
    // this uiMode) so the gate hook still runs against a stable key.
    return candidates[0]!;
};
