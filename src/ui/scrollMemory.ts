import { DateTime, Duration } from "effect";
import type { UiMode } from "../logic/ClueState";

// Per-uiMode scroll memory with a 2-minute "since last visit" TTL.
// Module-scoped so the four `newGame` dispatch sites can import
// `resetScrollMemory` directly. Reload resets to defaults because
// module state is per-page-load.
//
// `lastVisitedAt` is updated on every scroll event (via `recordScroll`)
// and on view enter/leave (via `touchScrollMemory`). On view re-entry,
// `getScroll` checks the elapsed time against the TTL: if expired, it
// returns 0 (the page will land at the top). The slot's saved `y` is
// left alone so subsequent calls within the same render cycle stay
// consistent; the next `recordScroll`/`touchScrollMemory` will reset
// `lastVisitedAt` and the slot becomes "live" again from that point.
const SCROLL_MEMORY_TTL = Duration.minutes(2);

interface ScrollSlot {
    readonly y: number;
    readonly lastVisitedAt: DateTime.Utc | null;
}

const emptySlot = (): ScrollSlot => ({ y: 0, lastVisitedAt: null });

const positions: Record<UiMode, ScrollSlot> = {
    setup: emptySlot(),
    checklist: emptySlot(),
    suggest: emptySlot(),
};

// Pending "skip the next restore" signals, one per uiMode. The tour
// sets this immediately before dispatching its own `setUiMode` so the
// per-view restore yields to the tour's `scrollSpotlightIntoView`.
// Without this gate, both systems fire on the mode change and race:
// the per-view restore (two rAFs ≈ 32ms) overrides the tour's
// immediate anchor scroll, and the tour's settle timers (150ms /
// 350ms) bail because `scrolledForStepRef` is already set. Net
// effect: the popover anchors offscreen. The suppression is one-shot
// and per-mode — `consumeScrollRestoreSuppression` removes the entry
// when it reads it. See CLAUDE.md's "Tour-popover verification"
// section for the invariant.
const suppressedRestores = new Set<UiMode>();

export const recordScroll = (mode: UiMode, y: number): void => {
    positions[mode] = { y, lastVisitedAt: DateTime.nowUnsafe() };
};

/**
 * Mark a view as "visited now" without changing its saved `y`. Called
 * on view enter and via the effect cleanup on view leave so a user
 * sitting on a view without scrolling doesn't have their slot expire
 * out from under them.
 */
export const touchScrollMemory = (mode: UiMode): void => {
    positions[mode] = {
        ...positions[mode],
        lastVisitedAt: DateTime.nowUnsafe(),
    };
};

export const getScroll = (mode: UiMode): number => {
    const slot = positions[mode];
    if (slot.lastVisitedAt === null) return 0;
    const elapsed = DateTime.distance(
        slot.lastVisitedAt,
        DateTime.nowUnsafe(),
    );
    if (Duration.toMillis(elapsed) > Duration.toMillis(SCROLL_MEMORY_TTL)) {
        return 0;
    }
    return slot.y;
};

export const resetScrollMemory = (): void => {
    positions.setup = emptySlot();
    positions.checklist = emptySlot();
    positions.suggest = emptySlot();
    suppressedRestores.clear();
};

/**
 * Mark the NEXT restore attempt for `mode` as a no-op. Called by the
 * tour right before it dispatches a `setUiMode` change — the tour's
 * own `scrollSpotlightIntoView` will move the page; the per-view
 * restore must yield rather than race.
 */
export const suppressNextScrollRestore = (mode: UiMode): void => {
    suppressedRestores.add(mode);
};

/**
 * Returns `true` (and clears the flag) if a restore for `mode` was
 * suppressed. The restore effect calls this immediately and bails
 * when the return is `true`. Returns `false` when no suppression was
 * pending — the normal path.
 */
export const consumeScrollRestoreSuppression = (mode: UiMode): boolean => {
    return suppressedRestores.delete(mode);
};
