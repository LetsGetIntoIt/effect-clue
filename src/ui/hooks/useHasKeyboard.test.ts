import { describe, expect, test, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useHasKeyboard } from "./useHasKeyboard";

interface MediaQueryListMock {
    matches: boolean;
    listeners: Set<() => void>;
}

function installMatchMedia(initial: boolean): MediaQueryListMock {
    const mql: MediaQueryListMock = {
        matches: initial,
        listeners: new Set(),
    };
    const matchMedia = (query: string) => {
        if (query !== "(hover: hover) and (pointer: fine)") {
            return {
                matches: false,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
            };
        }
        return {
            get matches() {
                return mql.matches;
            },
            addEventListener: (_event: string, cb: () => void) => {
                mql.listeners.add(cb);
            },
            removeEventListener: (_event: string, cb: () => void) => {
                mql.listeners.delete(cb);
            },
        };
    };
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: matchMedia,
    });
    return mql;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("useHasKeyboard", () => {
    test("returns true when hover+fine pointer matches (desktop / laptop)", () => {
        installMatchMedia(true);
        const { result } = renderHook(() => useHasKeyboard());
        expect(result.current).toBe(true);
    });

    test("returns false when hover+fine pointer doesn't match (touch-only)", () => {
        installMatchMedia(false);
        const { result } = renderHook(() => useHasKeyboard());
        expect(result.current).toBe(false);
    });
});
