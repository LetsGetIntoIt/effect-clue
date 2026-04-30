import { afterEach, describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";

import { useViewportCenteredModalStyle } from "./useViewportCenteredModalStyle";

interface VisualViewportLike {
    offsetLeft: number;
    offsetTop: number;
    width: number;
    height: number;
    addEventListener: () => void;
    removeEventListener: () => void;
}

const ORIGINAL_VISUAL_VIEWPORT = Object.getOwnPropertyDescriptor(
    window,
    "visualViewport",
);
const ORIGINAL_SCROLL_X = window.scrollX;
const ORIGINAL_SCROLL_Y = window.scrollY;
const ORIGINAL_INNER_WIDTH = window.innerWidth;
const ORIGINAL_INNER_HEIGHT = window.innerHeight;

function setVisualViewport(vv: VisualViewportLike | undefined): void {
    Object.defineProperty(window, "visualViewport", {
        configurable: true,
        writable: true,
        value: vv,
    });
}

function setScrollAndInner(
    scrollX: number,
    scrollY: number,
    innerWidth: number,
    innerHeight: number,
): void {
    Object.defineProperty(window, "scrollX", { configurable: true, value: scrollX });
    Object.defineProperty(window, "scrollY", { configurable: true, value: scrollY });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
}

afterEach(() => {
    if (ORIGINAL_VISUAL_VIEWPORT) {
        Object.defineProperty(window, "visualViewport", ORIGINAL_VISUAL_VIEWPORT);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any).visualViewport;
    }
    setScrollAndInner(
        ORIGINAL_SCROLL_X,
        ORIGINAL_SCROLL_Y,
        ORIGINAL_INNER_WIDTH,
        ORIGINAL_INNER_HEIGHT,
    );
});

describe("useViewportCenteredModalStyle", () => {
    test("uses visualViewport.offsetLeft + width/2 when visualViewport is supported", () => {
        setVisualViewport({
            offsetLeft: 200,
            offsetTop: 50,
            width: 400,
            height: 800,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        });
        const { result } = renderHook(() => useViewportCenteredModalStyle());
        expect(result.current.position).toBe("fixed");
        expect(result.current.left).toBe(`${200 + 400 / 2}px`);
        expect(result.current.top).toBe(`${50 + 800 / 2}px`);
        expect(result.current.transform).toBe("translate(-50%, -50%)");
    });

    test("falls back to window.scrollX + innerWidth/2 when visualViewport is unavailable", () => {
        setVisualViewport(undefined);
        setScrollAndInner(150, 30, 1024, 768);
        const { result } = renderHook(() => useViewportCenteredModalStyle());
        expect(result.current.left).toBe(`${150 + 1024 / 2}px`);
        expect(result.current.top).toBe(`${30 + 768 / 2}px`);
    });

    test("centers at viewport center when there's no horizontal scroll (preserves prior centering on desktop)", () => {
        setVisualViewport({
            offsetLeft: 0,
            offsetTop: 0,
            width: 1280,
            height: 800,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        });
        const { result } = renderHook(() => useViewportCenteredModalStyle());
        expect(result.current.left).toBe(`${1280 / 2}px`);
        expect(result.current.top).toBe(`${800 / 2}px`);
    });
});
