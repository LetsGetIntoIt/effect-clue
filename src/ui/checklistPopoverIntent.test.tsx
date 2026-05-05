import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Card, Player, PlayerOwner } from "../logic/GameObjects";
import { Cell } from "../logic/Knowledge";
import { SelectionProvider, useSelection } from "./SelectionContext";
import {
    EXIT_TIMEOUT_MS,
    OPEN_DELAY_MS,
    useWhyHoverIntent,
} from "./checklistPopoverIntent";

const p1 = Player("P1");
const p2 = Player("P2");
const c1 = Card("weapon:rope");
const c2 = Card("weapon:wrench");
const cellA = Cell(PlayerOwner(p1), c1);
const cellB = Cell(PlayerOwner(p2), c2);

function Wrapper({ children }: { children: ReactNode }) {
    return <SelectionProvider>{children}</SelectionProvider>;
}

function useHarness() {
    const intent = useWhyHoverIntent();
    const { popoverCell } = useSelection();
    return { intent, popoverCell };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("useWhyHoverIntent — open delay (not yet in popovers mode)", () => {
    test("hovering a cell opens its popover after OPEN_DELAY_MS", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        expect(result.current.popoverCell).toBeNull();
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
        });
        act(() => {
            vi.advanceTimersByTime(OPEN_DELAY_MS - 1);
        });
        expect(result.current.popoverCell).toBeNull();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current.popoverCell).toEqual(cellA);
    });

    test("leaving a cell before OPEN_DELAY_MS cancels the open", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
        });
        act(() => {
            vi.advanceTimersByTime(OPEN_DELAY_MS - 50);
            result.current.intent.onCellPointerLeave();
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        expect(result.current.popoverCell).toBeNull();
    });
});

describe("useWhyHoverIntent — popovers mode: immediate swap on enter", () => {
    test("hovering another cell swaps the popover immediately (no delay)", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        expect(result.current.popoverCell).toEqual(cellA);
        act(() => {
            result.current.intent.onCellPointerEnter(cellB);
        });
        expect(result.current.popoverCell).toEqual(cellB);
    });
});

describe("useWhyHoverIntent — exit timer (any cell-enter cancels)", () => {
    test("entering a new cell cancels the exit timer immediately — no settle required", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        // Enter popovers mode via initial open-delay.
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        // Leave A → exit timer arms.
        act(() => {
            result.current.intent.onCellPointerLeave();
        });
        // Enter B at t=200ms after leave (within the budget). No
        // need to linger — entry alone cancels the exit.
        act(() => {
            vi.advanceTimersByTime(200);
            result.current.intent.onCellPointerEnter(cellB);
        });
        // Even past the original 900ms boundary the popover stays
        // open on B because the exit timer is gone.
        act(() => {
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS * 2);
        });
        expect(result.current.popoverCell).toEqual(cellB);
    });

    test("rapid bouncing between cells stays in mode (each enter cancels the exit timer)", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        // Bounce between A and B every 100ms; never staying long
        // enough to "settle" under the old rules.
        act(() => {
            result.current.intent.onCellPointerLeave();
        });
        for (let i = 0; i < 8; i++) {
            act(() => {
                vi.advanceTimersByTime(100);
                result.current.intent.onCellPointerEnter(
                    i % 2 === 0 ? cellB : cellA,
                );
                vi.advanceTimersByTime(50);
                result.current.intent.onCellPointerLeave();
            });
        }
        // Final enter on a cell — popover should still be alive
        // because every previous enter canceled the exit timer.
        act(() => {
            vi.advanceTimersByTime(50);
            result.current.intent.onCellPointerEnter(cellA);
        });
        expect(result.current.popoverCell).toEqual(cellA);
    });

    test("entering then leaving re-arms the exit timer from the most recent leave", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        // Leave A at t=0 (relative).
        act(() => {
            result.current.intent.onCellPointerLeave();
        });
        // Enter B at t=200 (cancels exit), leave B at t=300.
        act(() => {
            vi.advanceTimersByTime(200);
            result.current.intent.onCellPointerEnter(cellB);
            vi.advanceTimersByTime(100);
            result.current.intent.onCellPointerLeave();
        });
        // From the second leave (t=300), exit fires at t=300+900=1200.
        // Originally — under the old "exit fires from first leave"
        // rule — it would have fired at t=900, before this point.
        act(() => {
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS - 100);
        });
        expect(result.current.popoverCell).toEqual(cellB);
        // Wait the rest of the new exit budget.
        act(() => {
            vi.advanceTimersByTime(100);
        });
        expect(result.current.popoverCell).toBeNull();
    });

    test("no cell-enter at all within EXIT_TIMEOUT_MS exits popovers mode", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        act(() => {
            result.current.intent.onCellPointerLeave();
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS);
        });
        expect(result.current.popoverCell).toBeNull();
    });
});

describe("useWhyHoverIntent — grid leave", () => {
    test("onGridLeave exits popovers mode immediately", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        expect(result.current.popoverCell).toEqual(cellA);
        act(() => {
            result.current.intent.onGridLeave();
        });
        expect(result.current.popoverCell).toBeNull();
    });

    test("onGridLeave cancels a pending open delay (not yet in popovers mode)", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS / 2);
            result.current.intent.onGridLeave();
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        expect(result.current.popoverCell).toBeNull();
    });

    test("onGridLeave cancels a pending exit timer in popovers mode", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
            result.current.intent.onCellPointerLeave();
            result.current.intent.onGridLeave();
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS * 2);
        });
        expect(result.current.popoverCell).toBeNull();
    });
});

describe("useWhyHoverIntent — cancelExitTimer integration", () => {
    test("cancelExitTimer prevents a pending exit from closing the popover", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
            result.current.intent.onCellPointerLeave();
            result.current.intent.cancelExitTimer();
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS * 2);
        });
        expect(result.current.popoverCell).toEqual(cellA);
    });

    test("cell → popover → cell flow keeps popover alive across portal traversal", () => {
        // Scenario: user opens popover on cellA, moves cursor across the
        // gap onto the portaled popover content, lingers, then moves
        // off it. The Checklist wires `onContentPointerEnter` →
        // `cancelExitTimer` and `onContentPointerLeave` →
        // `onCellPointerLeave`. We exercise that handshake here through
        // the hook's public API (no DOM needed).
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        // Open popover.
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        expect(result.current.popoverCell).toEqual(cellA);
        // Pointer leaves cellA — exit timer arms.
        act(() => {
            result.current.intent.onCellPointerLeave();
        });
        // Pointer enters popover content (or its hover bridge) within
        // the grace window — Checklist calls cancelExitTimer.
        act(() => {
            vi.advanceTimersByTime(200);
            result.current.intent.cancelExitTimer();
        });
        // Popover stays open well past the original exit budget.
        act(() => {
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS * 2);
        });
        expect(result.current.popoverCell).toEqual(cellA);
        // Pointer leaves popover content — Checklist calls
        // onCellPointerLeave, which arms the exit timer again.
        act(() => {
            result.current.intent.onCellPointerLeave();
        });
        // Without re-engagement, popover closes after the exit budget.
        act(() => {
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS - 1);
        });
        expect(result.current.popoverCell).toEqual(cellA);
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current.popoverCell).toBeNull();
    });
});

describe("useWhyHoverIntent — unmount cleanup", () => {
    test("unmounting clears pending timers without firing them", () => {
        let tracked: ReturnType<typeof useSelection>["popoverCell"] = null;
        function Harness() {
            const intent = useWhyHoverIntent();
            const sel = useSelection();
            tracked = sel.popoverCell;
            if (!sel.popoverCell) intent.onCellPointerEnter(cellA);
            return null;
        }
        const { unmount } = render(
            <Wrapper>
                <Harness />
            </Wrapper>,
        );
        act(() => {
            unmount();
            vi.advanceTimersByTime(OPEN_DELAY_MS * 5);
        });
        expect(tracked).toBeNull();
    });
});
