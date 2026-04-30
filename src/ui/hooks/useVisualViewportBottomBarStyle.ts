"use client";

import { useSyncExternalStore } from "react";

/**
 * Inline `style={{}}` that pins a bottom-bar element to the bottom
 * edge of the **visual** viewport — not the layout viewport.
 *
 * Why: when `<main>` uses `min-w-max` so the wide setup checklist can
 * scroll horizontally, the body becomes wider than the visible
 * viewport. On mobile Chrome `position: fixed; inset-x-0; bottom: 0`
 * resolves against the layout viewport / body box — `right: 0` lands
 * at body-right (~1100px on a 390px screen) and the nav stretches off
 * the side. Even `width: 100vw` doesn't help on every device because
 * `vw` units track the layout viewport, not the visual one.
 *
 * This hook reads `window.visualViewport.{offsetLeft, offsetTop,
 * width, height}` — the *visible* rectangle — and returns
 * `position: fixed` plus explicit pixel offsets that anchor the
 * element's bottom edge at `vv.offsetTop + vv.height` (with
 * `transform: translateY(-100%)` shifting it up by its own height)
 * and its left edge at `vv.offsetLeft`. Re-snaps live as the user
 * scrolls or pinch-zooms.
 *
 * Falls back to `window.scrollX/scrollY/innerWidth/innerHeight` on
 * UAs without `visualViewport`.
 */
interface BottomBarStyle {
    readonly position: "fixed";
    readonly left: string;
    readonly top: string;
    readonly width: string;
    readonly transform: string;
}

const TRANSFORM = "translateY(-100%)";

let cached: BottomBarStyle | null = null;

function compute(): BottomBarStyle {
    const vv = window.visualViewport;
    const offsetLeft = vv ? vv.offsetLeft : window.scrollX;
    const offsetTop = vv ? vv.offsetTop : window.scrollY;
    const width = vv ? vv.width : window.innerWidth;
    const height = vv ? vv.height : window.innerHeight;
    return {
        // eslint-disable-next-line i18next/no-literal-string
        position: "fixed",
        left: `${offsetLeft}px`,
        top: `${offsetTop + height}px`,
        width: `${width}px`,
        transform: TRANSFORM,
    };
}

function getSnapshot(): BottomBarStyle {
    const next = compute();
    if (
        cached !== null
        && cached.left === next.left
        && cached.top === next.top
        && cached.width === next.width
    ) {
        return cached;
    }
    cached = next;
    return next;
}

function subscribe(onChange: () => void): () => void {
    const vv = window.visualViewport;
    if (vv) {
        vv.addEventListener("scroll", onChange);
        vv.addEventListener("resize", onChange);
        return () => {
            vv.removeEventListener("scroll", onChange);
            vv.removeEventListener("resize", onChange);
        };
    }
    window.addEventListener("scroll", onChange);
    window.addEventListener("resize", onChange);
    return () => {
        window.removeEventListener("scroll", onChange);
        window.removeEventListener("resize", onChange);
    };
}

const SERVER_SNAPSHOT: BottomBarStyle = {
    position: "fixed",
    left: "0px",
    top: "100%",
    width: "100%",
    transform: TRANSFORM,
};

function getServerSnapshot(): BottomBarStyle {
    return SERVER_SNAPSHOT;
}

export function useVisualViewportBottomBarStyle(): BottomBarStyle {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
