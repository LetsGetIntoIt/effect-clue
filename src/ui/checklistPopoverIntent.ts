"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Cell } from "../logic/Knowledge";
import { useSelection } from "./SelectionContext";

/**
 * Initial delay (ms) before a sustained hover on a single cell opens
 * its "why" popover. Long enough that a casual mouse-sweep across the
 * grid does not strobe popovers; short enough to feel snappy once the
 * user has committed to a target cell.
 */
export const OPEN_DELAY_MS = 300;

/**
 * Exit-timeout (ms) — grace window after the pointer leaves a cell
 * while in popovers mode. If the pointer enters any cell within this
 * window, the timer is canceled and the popover stays open. If it
 * doesn't, the popover closes.
 *
 * The window is generous on purpose: any cell-enter cancels it, so a
 * long timeout only matters when the user briefly leaves the grid (a
 * gutter, a margin, the document edge) and returns. It doesn't slow
 * down deliberate dismissal — `onGridLeave` closes immediately.
 */
export const EXIT_TIMEOUT_MS = 900;

/**
 * Hover-intent driver for the checklist "why" popovers.
 *
 * ## State: popovers mode
 *
 * `popoverCell` (on `SelectionContext`) is the currently-open cell, or
 * `null` when no popover is visible. "Popovers mode" is the condition
 * `popoverCell !== null`. While in popovers mode, hovering any new
 * cell swaps the popover immediately (no settle delay) — once the
 * user has committed to reading, every cell-hover counts as continued
 * engagement.
 *
 * ## Enter popovers mode (any one of)
 *
 * 1. **Delayed hover.** Hovering a cell for `OPEN_DELAY_MS` (300 ms)
 *    continuously while not yet in popovers mode fires `openDelayTimer`
 *    and sets `popoverCell` to that cell.
 * 2. **Click or tap.** Clicking/tapping a deducible cell. Flows through
 *    Radix's trigger → `onOpenChange(true)` in the parent, which calls
 *    `setPopoverCell(thisCell)` directly. Parent should also call
 *    `cancelExitTimer()` (exposed from this hook) so any in-flight
 *    decay cannot close the popover the user just explicitly requested.
 * 3. **Keyboard activation.** Enter or Space on a focused cell. The
 *    existing Checklist keybinding synthesizes a click on the cell,
 *    which reuses path (2).
 *
 * ## Exit popovers mode (any one of)
 *
 * 1. **Pointer leaves the grid** — `onGridLeave` wired to the grid
 *    root's `onMouseLeave`. Immediate exit.
 * 2. **Focus leaves the grid** — `onGridLeave` wired to the grid
 *    root's `onBlur` with an outside `relatedTarget`. Immediate exit.
 * 3. **Explicit dismiss** — clicking the open cell again, clicking
 *    outside, pressing Esc inside the popover, or any other Radix
 *    dismiss path → `onOpenChange(false)` → parent calls
 *    `setPopoverCell(null)`. Immediate exit.
 * 4. **Exit timer fires.** Started on `onCellPointerLeave` while in
 *    popovers mode; `EXIT_TIMEOUT_MS` (900 ms). Canceled by ANY
 *    cell-enter while in mode — the user just has to land on another
 *    cell within the budget; they don't need to linger on it.
 *
 * ## Timers (private refs)
 *
 * - `openDelayTimer`: `OPEN_DELAY_MS`. Runs only while NOT in popovers
 *   mode. Started on cell-enter, canceled on cell-leave or grid-leave.
 *   Opens the popover (entering popovers mode) when it fires.
 * - `exitTimer`: `EXIT_TIMEOUT_MS`. Runs only while IN popovers mode.
 *   Started on cell-leave (only if not already armed). Canceled by
 *   any cell-enter while in mode, by explicit `cancelExitTimer`, or
 *   by grid-leave. Closes the popover when it fires.
 *
 * The previous "settle" timer (a 300 ms continuous-hover requirement
 * before a new cell counted as engagement) was removed: it caused a
 * race where rapid lateral mouse movement across cells would never
 * settle and the original exit timer would fire under the cursor,
 * making the popover disappear mid-hover. Without settle, the rule
 * becomes "while in mode, hovering any cell keeps the popover alive"
 * — trivially correct.
 */
interface WhyHoverIntent {
    readonly onCellPointerEnter: (cell: Cell) => void;
    readonly onCellPointerLeave: () => void;
    readonly onGridLeave: () => void;
    readonly cancelExitTimer: () => void;
}

export function useWhyHoverIntent(): WhyHoverIntent {
    const { popoverCell, setPopoverCell } = useSelection();
    const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearOpen = useCallback(() => {
        if (openTimerRef.current !== null) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
    }, []);

    const cancelExitTimer = useCallback(() => {
        if (exitTimerRef.current !== null) {
            clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
        }
    }, []);

    const onCellPointerEnter = useCallback(
        (cell: Cell) => {
            if (popoverCell !== null) {
                // Already in popovers mode: swap the visible popover
                // to the new cell immediately AND cancel any pending
                // exit. Hovering any cell counts as engagement.
                clearOpen();
                cancelExitTimer();
                setPopoverCell(cell);
            } else {
                // Not in popovers mode: start the open-delay timer.
                clearOpen();
                openTimerRef.current = setTimeout(() => {
                    openTimerRef.current = null;
                    setPopoverCell(cell);
                }, OPEN_DELAY_MS);
            }
        },
        [popoverCell, setPopoverCell, clearOpen, cancelExitTimer],
    );

    const onCellPointerLeave = useCallback(() => {
        // Cancel any pending open that was racing to fire. If we're
        // in popovers mode and no exit timer is already armed, start
        // one now.
        clearOpen();
        if (popoverCell !== null && exitTimerRef.current === null) {
            exitTimerRef.current = setTimeout(() => {
                exitTimerRef.current = null;
                setPopoverCell(null);
            }, EXIT_TIMEOUT_MS);
        }
    }, [popoverCell, setPopoverCell, clearOpen]);

    const onGridLeave = useCallback(() => {
        clearOpen();
        cancelExitTimer();
        setPopoverCell(null);
    }, [setPopoverCell, clearOpen, cancelExitTimer]);

    useEffect(
        () => () => {
            clearOpen();
            cancelExitTimer();
        },
        [clearOpen, cancelExitTimer],
    );

    return {
        onCellPointerEnter,
        onCellPointerLeave,
        onGridLeave,
        cancelExitTimer,
    };
}
