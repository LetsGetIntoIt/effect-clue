"use client";

import { useSyncExternalStore } from "react";

/**
 * True when the current device is likely driven with a hardware
 * keyboard (and a fine-pointer device — mouse / trackpad). False on
 * touch-only devices like phones and tablets without a keyboard
 * attached. Used to suppress keyboard-shortcut hints (`(⌘K)`,
 * `(⌘↵)`, …) and "Press Enter to edit" affordances on devices where
 * the user can't act on them.
 *
 * Backed by `matchMedia("(hover: hover) and (pointer: fine)")` via
 * `useSyncExternalStore` so it stays in sync across consumers and
 * updates live (e.g. when the user attaches or detaches a keyboard
 * to an iPad).
 *
 * SSR snapshot: `true` (desktop-first default), matching the
 * sibling `useIsDesktop` convention.
 */
const KEYBOARD_QUERY = "(hover: hover) and (pointer: fine)";

export function useHasKeyboard(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onChange: () => void): () => void {
    const mq = window.matchMedia(KEYBOARD_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
    return window.matchMedia(KEYBOARD_QUERY).matches;
}

function getServerSnapshot(): boolean {
    return true;
}
