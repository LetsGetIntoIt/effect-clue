import { afterEach, describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";

import { useVisualViewportBottomBarStyle } from "./useVisualViewportBottomBarStyle";

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

describe("useVisualViewportBottomBarStyle", () => {
    test("anchors to visualViewport's bottom-left corner with its width", () => {
        setVisualViewport({
            offsetLeft: 0,
            offsetTop: 0,
            width: 390,
            height: 844,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        });
        const { result } = renderHook(() =>
            useVisualViewportBottomBarStyle(),
        );
        expect(result.current.position).toBe("fixed");
        expect(result.current.left).toBe("0px");
        expect(result.current.top).toBe("844px");
        expect(result.current.width).toBe("390px");
        expect(result.current.transform).toBe("translateY(-100%)");
    });

    test("tracks visualViewport offset when user pinch-zooms or pans (mobile)", () => {
        setVisualViewport({
            offsetLeft: 100,
            offsetTop: 50,
            width: 200,
            height: 400,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        });
        const { result } = renderHook(() =>
            useVisualViewportBottomBarStyle(),
        );
        expect(result.current.left).toBe("100px");
        expect(result.current.top).toBe(`${50 + 400}px`);
        expect(result.current.width).toBe("200px");
    });

    test("falls back to window.scrollX / innerWidth when visualViewport is unavailable", () => {
        setVisualViewport(undefined);
        setScrollAndInner(0, 0, 1024, 768);
        const { result } = renderHook(() =>
            useVisualViewportBottomBarStyle(),
        );
        expect(result.current.left).toBe("0px");
        expect(result.current.top).toBe("768px");
        expect(result.current.width).toBe("1024px");
    });
});
