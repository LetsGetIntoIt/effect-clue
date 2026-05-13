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
};
