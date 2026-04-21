import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "effect-clue.streamlined-input";

const readInitial = (): boolean => {
    if (typeof window === "undefined") return true;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return true;
        return raw === "true";
    } catch {
        return true;
    }
};

/**
 * Persists the "streamlined input" preference across sessions. The
 * streamlined natural-language input is on by default; the user can
 * flip to the old per-category dropdown form if they prefer it.
 *
 * SSR-safe: the hook returns `true` on the first render (matching the
 * default), then syncs the value from `localStorage` inside a layout
 * effect. This keeps the initial HTML deterministic and avoids a
 * hydration warning.
 */
export function useStreamlinedToggle(): readonly [boolean, (next: boolean) => void] {
    const [value, setValue] = useState<boolean>(true);

    useEffect(() => {
        setValue(readInitial());
    }, []);

    const setAndPersist = useCallback((next: boolean) => {
        setValue(next);
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
        } catch {
            // localStorage may be unavailable (private mode); ignore.
        }
    }, []);

    return [value, setAndPersist] as const;
}
