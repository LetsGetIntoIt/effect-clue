"use client";

import { useEffect, useState } from "react";

/**
 * Reports whether the device can hover with a fine-grained pointer (mouse
 * / trackpad). Used to decide whether to open Radix tooltips on hover vs.
 * only on click/long-press.
 *
 * Defaults to `true` on first render so SSR output matches the desktop
 * assumption (React Server Components can't run `matchMedia`). The effect
 * flips it to the real value on mount — any hover-only UI that renders
 * during the first paint on a touch device is self-dismissing on leave,
 * so the mismatch is harmless.
 *
 * Listens for `change` on the media query list so plugging a mouse into
 * an iPad (or detaching one) flips the value live without a reload.
 */
export function useHoverCapable(): boolean {
    const [hoverCapable, setHoverCapable] = useState<boolean>(true);
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mql = window.matchMedia("(hover: hover) and (pointer: fine)");
        setHoverCapable(mql.matches);
        const handler = (e: MediaQueryListEvent) => setHoverCapable(e.matches);
        mql.addEventListener("change", handler);
        return () => mql.removeEventListener("change", handler);
    }, []);
    return hoverCapable;
}
