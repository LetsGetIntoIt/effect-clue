"use client";

import { useSyncExternalStore } from "react";

/**
 * Inline `style={{}}` that centers a fixed-positioned modal in the
 * **visual** viewport — not the layout viewport. Pair with
 * `position: fixed` content (Radix `Dialog.Content` /
 * `AlertDialog.Content`).
 *
 * Why: when the document is wider than the viewport (the wide setup
 * checklist forces `<main>` past 100vw), mobile browsers' touch
 * horizontal-scroll shifts the visual viewport without moving the
 * layout viewport. CSS `left: 50%; top: 50%` resolves to the *layout*
 * viewport's center — which is offscreen. This hook anchors the modal
 * to the **visible** region using `window.visualViewport.offsetLeft +
 * width / 2` (and the y axis), and re-centers live as the user keeps
 * scrolling / pinch-zooming with the modal open.
 *
 * Falls back to `window.scrollX + innerWidth / 2` on UAs without
 * `visualViewport` (older non-mobile browsers), which still lands the
 * modal at the visible center on a horizontally scrolled page.
 *
 * SSR snapshot: `{ left: "50%", top: "50%" }` — the static-export
 * pre-render has no DOM, and on first hydration the hook re-snaps to
 * the live values before paint.
 */
interface CenterStyle {
    readonly position: "fixed";
    readonly left: string;
    readonly top: string;
    readonly transform: string;
}

const TRANSFORM = "translate(-50%, -50%)";

let cached: CenterStyle | null = null;

function compute(): CenterStyle {
    const vv = window.visualViewport;
    const left = vv
        ? vv.offsetLeft + vv.width / 2
        : window.scrollX + window.innerWidth / 2;
    const top = vv
        ? vv.offsetTop + vv.height / 2
        : window.scrollY + window.innerHeight / 2;
    return {
        // eslint-disable-next-line i18next/no-literal-string
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        transform: TRANSFORM,
    };
}

function getSnapshot(): CenterStyle {
    const next = compute();
    if (
        cached !== null
        && cached.left === next.left
        && cached.top === next.top
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

const SERVER_SNAPSHOT: CenterStyle = {
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: TRANSFORM,
};

function getServerSnapshot(): CenterStyle {
    return SERVER_SNAPSHOT;
}

export function useViewportCenteredModalStyle(): CenterStyle {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
