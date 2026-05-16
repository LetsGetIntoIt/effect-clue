import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useDragControls } from "motion/react";
import { useReorderPressDelay } from "./useReorderPressDelay";

/**
 * Per-test harness: renders a `<div>` wired up with the press-delay
 * handlers and exposes the `DragControls` instance via a ref so the
 * test can spy on `controls.start`.
 */
function Harness({
    onMount,
    targetTag = "div",
}: {
    readonly onMount: (controls: ReturnType<typeof useDragControls>) => void;
    readonly targetTag?: "div" | "button";
}) {
    const controls = useDragControls();
    onMount(controls);
    const press = useReorderPressDelay(controls);
    if (targetTag === "button") {
        return (
            <div data-testid="row" {...press}>
                <button type="button" data-testid="inner-btn">
                    inner
                </button>
            </div>
        );
    }
    return <div data-testid="row" {...press} />;
}

const dispatchPointer = (
    element: HTMLElement,
    type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
    coords: { x: number; y: number } = { x: 50, y: 50 },
): void => {
    fireEvent[type](element, {
        clientX: coords.x,
        clientY: coords.y,
        pointerType: "touch",
        pointerId: 1,
    });
};

describe("useReorderPressDelay", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    test("calls controls.start after the press delay elapses", () => {
        let capturedControls!: ReturnType<typeof useDragControls>;
        const { getByTestId } = render(
            <Harness onMount={(c) => (capturedControls = c)} />,
        );
        const startSpy = vi.spyOn(capturedControls, "start");

        dispatchPointer(getByTestId("row"), "pointerDown");
        // Just before the 250ms threshold: nothing fired yet.
        vi.advanceTimersByTime(249);
        expect(startSpy).not.toHaveBeenCalled();
        // Crossing 250ms fires the drag-start.
        vi.advanceTimersByTime(1);
        expect(startSpy).toHaveBeenCalledTimes(1);
    });

    test("pointer-up before the delay cancels drag-start", () => {
        let capturedControls!: ReturnType<typeof useDragControls>;
        const { getByTestId } = render(
            <Harness onMount={(c) => (capturedControls = c)} />,
        );
        const startSpy = vi.spyOn(capturedControls, "start");
        const row = getByTestId("row");

        dispatchPointer(row, "pointerDown");
        vi.advanceTimersByTime(100);
        dispatchPointer(row, "pointerUp");
        vi.advanceTimersByTime(500); // well past the original delay
        expect(startSpy).not.toHaveBeenCalled();
    });

    test("pointer-cancel before the delay cancels drag-start", () => {
        let capturedControls!: ReturnType<typeof useDragControls>;
        const { getByTestId } = render(
            <Harness onMount={(c) => (capturedControls = c)} />,
        );
        const startSpy = vi.spyOn(capturedControls, "start");
        const row = getByTestId("row");

        dispatchPointer(row, "pointerDown");
        vi.advanceTimersByTime(100);
        dispatchPointer(row, "pointerCancel");
        vi.advanceTimersByTime(500);
        expect(startSpy).not.toHaveBeenCalled();
    });

    test("pointer-move past the tolerance cancels drag-start (allows scroll)", () => {
        let capturedControls!: ReturnType<typeof useDragControls>;
        const { getByTestId } = render(
            <Harness onMount={(c) => (capturedControls = c)} />,
        );
        const startSpy = vi.spyOn(capturedControls, "start");
        const row = getByTestId("row");

        dispatchPointer(row, "pointerDown", { x: 50, y: 50 });
        // 9 px down — past the 8 px tolerance.
        dispatchPointer(row, "pointerMove", { x: 50, y: 59 });
        vi.advanceTimersByTime(500);
        expect(startSpy).not.toHaveBeenCalled();
    });

    test("small jitter under the tolerance does NOT cancel drag-start", () => {
        let capturedControls!: ReturnType<typeof useDragControls>;
        const { getByTestId } = render(
            <Harness onMount={(c) => (capturedControls = c)} />,
        );
        const startSpy = vi.spyOn(capturedControls, "start");
        const row = getByTestId("row");

        dispatchPointer(row, "pointerDown", { x: 50, y: 50 });
        // 5 px diagonal — under the 8 px tolerance.
        dispatchPointer(row, "pointerMove", { x: 53, y: 54 });
        vi.advanceTimersByTime(250);
        expect(startSpy).toHaveBeenCalledTimes(1);
    });

    test("pointer-down on an interactive child does not arm the timer", () => {
        let capturedControls!: ReturnType<typeof useDragControls>;
        const { getByTestId } = render(
            <Harness
                onMount={(c) => (capturedControls = c)}
                targetTag="button"
            />,
        );
        const startSpy = vi.spyOn(capturedControls, "start");

        dispatchPointer(getByTestId("inner-btn"), "pointerDown");
        // Even after the full delay, no drag start — the press was on a button.
        vi.advanceTimersByTime(500);
        expect(startSpy).not.toHaveBeenCalled();
    });

    test("unmount cleans up the pending timer", () => {
        let capturedControls!: ReturnType<typeof useDragControls>;
        const { getByTestId, unmount } = render(
            <Harness onMount={(c) => (capturedControls = c)} />,
        );
        const startSpy = vi.spyOn(capturedControls, "start");
        dispatchPointer(getByTestId("row"), "pointerDown");
        unmount();
        vi.advanceTimersByTime(500);
        expect(startSpy).not.toHaveBeenCalled();
    });
});
