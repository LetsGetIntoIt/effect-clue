import { afterEach, describe, expect, test } from "vitest";
import { DateTime } from "effect";
import {
    loadSplashState,
    saveDismissed,
    saveLastVisited,
} from "./SplashState";

const STORAGE_KEY = "effect-clue.splash.v1";

afterEach(() => {
    window.localStorage.clear();
});

describe("SplashState", () => {
    test("returns empty state when nothing is stored", () => {
        expect(loadSplashState()).toEqual({});
    });

    test("returns empty state when payload is malformed", () => {
        window.localStorage.setItem(STORAGE_KEY, "not json");
        expect(loadSplashState()).toEqual({});
    });

    test("returns empty state when schema rejects payload", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 99, lastVisitedAt: "garbage" }),
        );
        expect(loadSplashState()).toEqual({});
    });

    test("round-trips lastVisitedAt", () => {
        const now = DateTime.makeUnsafe("2026-04-25T12:00:00Z");
        saveLastVisited(now);
        const state = loadSplashState();
        expect(state.lastVisitedAt).toEqual(now);
        expect(state.lastDismissedAt).toBeUndefined();
    });

    test("round-trips lastDismissedAt", () => {
        const now = DateTime.makeUnsafe("2026-04-25T12:00:00Z");
        saveDismissed(now);
        const state = loadSplashState();
        expect(state.lastDismissedAt).toEqual(now);
        expect(state.lastVisitedAt).toBeUndefined();
    });

    test("saving lastVisitedAt does not clobber lastDismissedAt", () => {
        const dismissedAt = DateTime.makeUnsafe("2026-03-01T00:00:00Z");
        const visitedAt = DateTime.makeUnsafe("2026-04-25T12:00:00Z");
        saveDismissed(dismissedAt);
        saveLastVisited(visitedAt);
        const state = loadSplashState();
        expect(state.lastDismissedAt).toEqual(dismissedAt);
        expect(state.lastVisitedAt).toEqual(visitedAt);
    });

    test("saving lastDismissedAt does not clobber lastVisitedAt", () => {
        const visitedAt = DateTime.makeUnsafe("2026-03-01T00:00:00Z");
        const dismissedAt = DateTime.makeUnsafe("2026-04-25T12:00:00Z");
        saveLastVisited(visitedAt);
        saveDismissed(dismissedAt);
        const state = loadSplashState();
        expect(state.lastDismissedAt).toEqual(dismissedAt);
        expect(state.lastVisitedAt).toEqual(visitedAt);
    });

    test("repeated saveLastVisited overwrites the timestamp", () => {
        const earlier = DateTime.makeUnsafe("2026-03-01T00:00:00Z");
        const later = DateTime.makeUnsafe("2026-04-25T12:00:00Z");
        saveLastVisited(earlier);
        saveLastVisited(later);
        expect(loadSplashState().lastVisitedAt).toEqual(later);
    });
});
