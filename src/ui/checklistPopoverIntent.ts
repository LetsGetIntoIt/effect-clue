"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Cell } from "../logic/Knowledge";
import { useSelection } from "./SelectionContext";

/**
 * Initial delay (ms) before a sustained hover on a single cell opens
 * its "why" popover. Long enough that a casual mouse-sweep across the
 * grid does not strobe popovers; short enough to feel snappy once the
 * user has committed to a target cell.
 *
 * Also doubles as the **settle window** inside popovers mode — a new
 * cell-hover only counts as engagement once the pointer has stayed on
 * that cell for this long.
 */
export const OPEN_DELAY_MS = 300;

/**
 * Exit-timeout (ms). Started on cell-leave while in popovers mode.
 * Canceled only when a subsequent settle (`OPEN_DELAY_MS` continuous
 * on a new cell) fires. So the user has `EXIT_TIMEOUT_MS -
 * OPEN_DELAY_MS = 600ms` to enter a new cell after leaving, and then
 * must remain on it for the full settle window to refresh engagement
 * — total budget `EXIT_TIMEOUT_MS`.
 */
export const EXIT_TIMEOUT_MS = 900;

/**
 * Hover-intent driver for the checklist "why" popovers.
 *
 * ## State: popovers mode
 *
 * `popoverCell` (on `SelectionContext`) is the currently-open cell, or
 * `null` when no popover is visible. "Popovers mode" is the condition
 * `popoverCell !== null`. While in popovers mode, hovering a new
 * deducible cell swaps the popover immediately (no settle delay between
 * cells) — once the user has committed to reading, the UI trusts them
 * with instant previews.
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
 *    popovers mode; `EXIT_TIMEOUT_MS` (900 ms). Canceled ONLY when a
 *    subsequent settle fires — the user must both enter a new cell
 *    *and* stay on it continuously for `OPEN_DELAY_MS` (300 ms) before
 *    the 900 ms budget runs out. Merely entering a new cell is not
 *    enough; the user has to linger on it.
 *
 * ## What does NOT exit popovers mode
 *
 * - Reading the open popover (not leaving the cell) — the exit timer
 *   doesn't start until the pointer leaves a cell.
 * - Entering a new cell within the budget (settle timer catches up
 *   and cancels the exit).
 *
 * ## What DOES exit popovers mode (subtle cases)
 *
 * - Rapid bouncing between cells where no single hover lasts long
 *   enough to settle — the exit timer fires 900 ms after the first
 *   leave, because no settle has cleared it.
 * - Hovering over grid gutters / empty cells long enough that no
 *   new settle completes within the budget.
 *
 * ## Timers (private refs)
 *
 * - `openDelayTimer`: `OPEN_DELAY_MS`. Runs only while NOT in popovers
 *   mode. Started on cell-enter, canceled on cell-leave or grid-leave.
 *   Opens the popover (entering popovers mode) when it fires.
 * - `settleTimer`: `OPEN_DELAY_MS`. Runs only while IN popovers mode.
 *   Started on cell-enter, canceled on cell-leave or grid-leave. When
 *   it fires, cancels any pending `exitTimer` (the user has now
 *   confirmed engagement on this cell).
 * - `exitTimer`: `EXIT_TIMEOUT_MS`. Runs only while IN popovers mode.
 *   Started on cell-leave, canceled by `settleTimer` completion,
 *   explicit activation (via the exported `cancelExitTimer`), or
 *   grid-leave. Closes the popover when it fires.
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
    const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearOpen = useCallback(() => {
        if (openTimerRef.current !== null) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
    }, []);

    const clearSettle = useCallback(() => {
        if (settleTimerRef.current !== null) {
            clearTimeout(settleTimerRef.current);
            settleTimerRef.current = null;
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
                // Already in popovers mode: swap the visible popover to
                // the new cell immediately. Start the settle timer;
                // when it fires it cancels the exit timer to confirm
                // engagement on this new cell. Note we do NOT cancel
                // the exit timer here — per the state machine, only a
                // completed settle counts as "engaged".
                clearOpen();
                clearSettle();
                setPopoverCell(cell);
                settleTimerRef.current = setTimeout(() => {
                    settleTimerRef.current = null;
                    cancelExitTimer();
                }, OPEN_DELAY_MS);
            } else {
                // Not in popovers mode: start the open-delay timer.
                clearOpen();
                openTimerRef.current = setTimeout(() => {
                    openTimerRef.current = null;
                    setPopoverCell(cell);
                }, OPEN_DELAY_MS);
            }
        },
        [popoverCell, setPopoverCell, clearOpen, clearSettle, cancelExitTimer],
    );

    const onCellPointerLeave = useCallback(() => {
        // Cancel any pending open that was racing to fire. If we're
        // in popovers mode and no exit timer is already armed, start
        // one now — settle timers (running or not) don't reset it.
        clearOpen();
        clearSettle();
        if (popoverCell !== null && exitTimerRef.current === null) {
            exitTimerRef.current = setTimeout(() => {
                exitTimerRef.current = null;
                setPopoverCell(null);
            }, EXIT_TIMEOUT_MS);
        }
    }, [popoverCell, setPopoverCell, clearOpen, clearSettle]);

    const onGridLeave = useCallback(() => {
        clearOpen();
        clearSettle();
        cancelExitTimer();
        setPopoverCell(null);
    }, [setPopoverCell, clearOpen, clearSettle, cancelExitTimer]);

    useEffect(
        () => () => {
            clearOpen();
            clearSettle();
            cancelExitTimer();
        },
        [clearOpen, clearSettle, cancelExitTimer],
    );

    return {
        onCellPointerEnter,
        onCellPointerLeave,
        onGridLeave,
        cancelExitTimer,
    };
}
