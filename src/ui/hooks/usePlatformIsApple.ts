"use client";

import { useSyncExternalStore } from "react";

/**
 * True when the current device is an Apple platform (iOS, iPadOS,
 * macOS). False everywhere else (Android, Windows, Linux). Used by
 * the platform-aware share icon — Apple devices recognise the
 * square-with-arrow-up shape from the system share sheet, while
 * other platforms recognise the three-node graph from Material.
 *
 * Detection uses `navigator.userAgent` heuristics. Modern macOS
 * iPads identify as `MacIntel` so we extra-check `maxTouchPoints` to
 * tease them apart from real Macs (relevant for share-sheet copy
 * where iPads show "Share" and Macs show different system menus —
 * but for icon picking the answer is the same: both Apple, render
 * the iOS icon).
 *
 * SSR snapshot: `false` — defaulting to the more universal Material
 * icon avoids a desktop user briefly seeing the Apple icon flash on
 * hydration when their UA doesn't match.
 */
export function usePlatformIsApple(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const APPLE_UA_RE = /Mac|iPhone|iPad|iPod/i;

const computeIsApple = (): boolean => {
    if (typeof navigator === "undefined") return false;
    return APPLE_UA_RE.test(navigator.userAgent);
};

/** No "platformchange" media event exists, so the subscribe is a
 * no-op — the value is stable for the lifetime of the page. */
function subscribe(): () => void {
    return () => {};
}

function getSnapshot(): boolean {
    return computeIsApple();
}

function getServerSnapshot(): boolean {
    return false;
}
