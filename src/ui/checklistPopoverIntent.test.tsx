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

describe("useWhyHoverIntent — exit timer (settle to refresh)", () => {
    test("entering a new cell within the budget AND settling for OPEN_DELAY_MS keeps the mode", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        // Enter popovers mode via initial settle.
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        // Leave A → exit timer arms.
        act(() => {
            result.current.intent.onCellPointerLeave();
        });
        // Enter B at t=200ms after leave (within the 600ms enter
        // window). Settle on B for OPEN_DELAY_MS — total 500ms < 900ms.
        act(() => {
            vi.advanceTimersByTime(200);
            result.current.intent.onCellPointerEnter(cellB);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        // Settle fired → exit timer canceled. Even past the 900ms
        // boundary the popover stays open on B.
        act(() => {
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS);
        });
        expect(result.current.popoverCell).toEqual(cellB);
    });

    test("entering a new cell but leaving before settle → exit fires at 900ms after the original leave", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        act(() => {
            result.current.intent.onCellPointerLeave();
        });
        // Enter B briefly (<OPEN_DELAY_MS), then leave again.
        act(() => {
            vi.advanceTimersByTime(100);
            result.current.intent.onCellPointerEnter(cellB);
            vi.advanceTimersByTime(100);
            result.current.intent.onCellPointerLeave();
        });
        // 200ms elapsed since the original leave — exit timer still
        // running. Now wait the rest of the 900ms.
        act(() => {
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS - 200);
        });
        expect(result.current.popoverCell).toBeNull();
    });

    test("merely entering a new cell (without settling) does NOT cancel the exit timer", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        act(() => {
            result.current.intent.onCellPointerLeave();
        });
        // Enter B at t=700ms; settle would complete at t=1000ms — past
        // the 900ms exit boundary. Exit fires before settle, popovers
        // mode exits.
        act(() => {
            vi.advanceTimersByTime(700);
            result.current.intent.onCellPointerEnter(cellB);
            vi.advanceTimersByTime(EXIT_TIMEOUT_MS - 700);
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

    test("rapid bouncing between cells (none long enough to settle) exits at 900ms", () => {
        const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
        act(() => {
            result.current.intent.onCellPointerEnter(cellA);
            vi.advanceTimersByTime(OPEN_DELAY_MS);
        });
        // Bounce between A and B every 100ms; never staying long
        // enough to settle.
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
        // The exit timer was set at the very first leave; nothing has
        // canceled it. By now we've well exceeded 900ms.
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
