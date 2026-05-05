"use client";

import { Duration, Equal } from "effect";
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
 * Delay before an already-open hover popover retargets to a newly
 * hovered cell. This keeps a transit cell from stealing the popover
 * while the pointer is moving from the trigger toward the portaled
 * content, but still lets intentional cell-to-cell browsing feel
 * responsive once the pointer rests on a new target.
 */
export const SWAP_DELAY_MS = Duration.toMillis(Duration.millis(140));

/**
 * Hover-intent driver for the checklist "why" popovers.
 *
 * ## State: popovers mode
 *
 * `popoverCell` (on `SelectionContext`) is the currently-open cell, or
 * `null` when no popover is visible. "Popovers mode" is the condition
 * `popoverCell !== null`. Hover-opened popovers retarget after
 * `SWAP_DELAY_MS` on a new cell; explicitly-opened popovers are
 * pinned so the user can move into their controls.
 *
 * ## Enter popovers mode (any one of)
 *
 * 1. **Delayed hover.** Hovering a cell for `OPEN_DELAY_MS` (300 ms)
 *    continuously while not yet in popovers mode fires `openDelayTimer`
 *    and sets `popoverCell` to that cell.
 * 2. **Click or tap.** Clicking/tapping a deducible cell. Flows through
 *    Radix's trigger → `onOpenChange(true)` in the parent, which calls
 *    `onExplicitOpen(thisCell)`. That pins the popover to the cell
 *    until explicit close, outside click, Escape, or grid leave.
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
 *    hover-opened popovers mode; `EXIT_TIMEOUT_MS` (900 ms). Canceled
 *    by ANY cell-enter while in mode — the user just has to land on
 *    another cell within the budget; they don't need to linger on it.
 *
 * ## Timers (private refs)
 *
 * - `openDelayTimer`: `OPEN_DELAY_MS`. Runs only while NOT in popovers
 *   mode. Started on cell-enter, canceled on cell-leave or grid-leave.
 *   Opens the popover (entering popovers mode) when it fires.
 * - `exitTimer`: `EXIT_TIMEOUT_MS`. Runs only while IN popovers mode.
 *   Started on cell-leave for hover-opened popovers (only if not
 *   already armed). Canceled by any cell-enter while in mode, by
 *   explicit `cancelExitTimer`, or by grid-leave. Closes the popover
 *   when it fires.
 * - `swapTimer`: `SWAP_DELAY_MS`. Runs while an unpinned popover is
 *   open and the pointer enters another cell. Entering the portaled
 *   content cancels it, so transit cells do not steal interactive
 *   popovers.
 */
interface WhyHoverIntent {
    readonly onCellPointerEnter: (cell: Cell) => void;
    readonly onCellPointerLeave: () => void;
    readonly onGridLeave: () => void;
    readonly onExplicitOpen: (cell: Cell) => void;
    readonly onExplicitClose: () => void;
    readonly cancelExitTimer: () => void;
}

export function useWhyHoverIntent(): WhyHoverIntent {
    const { popoverCell, setPopoverCell } = useSelection();
    const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pinnedCellRef = useRef<Cell | null>(null);

    const clearOpen = useCallback(() => {
        if (openTimerRef.current !== null) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
    }, []);

    const clearSwap = useCallback(() => {
        if (swapTimerRef.current !== null) {
            clearTimeout(swapTimerRef.current);
            swapTimerRef.current = null;
        }
    }, []);

    const cancelExitTimer = useCallback(() => {
        if (exitTimerRef.current !== null) {
            clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
        }
        clearSwap();
    }, [clearSwap]);

    const onCellPointerEnter = useCallback(
        (cell: Cell) => {
            if (popoverCell !== null) {
                // Already in popovers mode: any cell-enter keeps the
                // current popover alive. Hover-opened popovers retarget
                // only after a short rest on the new cell; explicitly
                // opened popovers stay pinned for interacting with
                // their controls.
                clearOpen();
                cancelExitTimer();
                if (pinnedCellRef.current !== null) return;
                if (Equal.equals(cell, popoverCell)) return;
                swapTimerRef.current = setTimeout(() => {
                    swapTimerRef.current = null;
                    setPopoverCell(cell);
                }, SWAP_DELAY_MS);
            } else {
                // Not in popovers mode: start the open-delay timer.
                clearOpen();
                openTimerRef.current = setTimeout(() => {
                    openTimerRef.current = null;
                    pinnedCellRef.current = null;
                    setPopoverCell(cell);
                }, OPEN_DELAY_MS);
            }
        },
        [popoverCell, setPopoverCell, clearOpen, cancelExitTimer],
    );

    const onCellPointerLeave = useCallback(() => {
        // Cancel any pending open that was racing to fire. If we're
        // in hover-opened popovers mode and no exit timer is already
        // armed, start one now. Pinned popovers behave like dialogs:
        // they stay up until explicit close, outside click, Escape, or
        // a true grid leave.
        clearOpen();
        clearSwap();
        if (
            popoverCell !== null
            && pinnedCellRef.current === null
            && exitTimerRef.current === null
        ) {
            exitTimerRef.current = setTimeout(() => {
                exitTimerRef.current = null;
                setPopoverCell(null);
            }, EXIT_TIMEOUT_MS);
        }
    }, [popoverCell, setPopoverCell, clearOpen, clearSwap]);

    const onGridLeave = useCallback(() => {
        pinnedCellRef.current = null;
        clearOpen();
        cancelExitTimer();
        setPopoverCell(null);
    }, [setPopoverCell, clearOpen, cancelExitTimer]);

    const onExplicitOpen = useCallback(
        (cell: Cell) => {
            pinnedCellRef.current = cell;
            clearOpen();
            cancelExitTimer();
            setPopoverCell(cell);
        },
        [setPopoverCell, clearOpen, cancelExitTimer],
    );

    const onExplicitClose = useCallback(() => {
        pinnedCellRef.current = null;
        clearOpen();
        cancelExitTimer();
        setPopoverCell(null);
    }, [setPopoverCell, clearOpen, cancelExitTimer]);

    useEffect(
        () => () => {
            pinnedCellRef.current = null;
            clearOpen();
            cancelExitTimer();
        },
        [clearOpen, cancelExitTimer],
    );

    return {
        onCellPointerEnter,
        onCellPointerLeave,
        onGridLeave,
        onExplicitOpen,
        onExplicitClose,
        cancelExitTimer,
    };
}
