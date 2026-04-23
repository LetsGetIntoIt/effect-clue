"use client";

import { useSyncExternalStore } from "react";

/**
 * True when the viewport is at or above the app's desktop
 * breakpoint (800px). Backed by `matchMedia` via
 * `useSyncExternalStore` so it stays in sync across all consumers
 * and updates on live viewport resize.
 *
 * The app is a static-export client-only SPA, so `window` is
 * always defined by the time this runs. The SSR snapshot returns
 * `true` as a safe default (desktop-first) in case it's ever
 * called during a pre-render pass.
 */
const DESKTOP_QUERY = "(min-width: 800px)";

export function useIsDesktop(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onChange: () => void): () => void {
    const mq = window.matchMedia(DESKTOP_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
    return window.matchMedia(DESKTOP_QUERY).matches;
}

function getServerSnapshot(): boolean {
    return true;
}
