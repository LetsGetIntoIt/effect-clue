/**
 * Storage-layer tests for per-screen tour state. Mirrors the
 * SplashState test coverage: each per-screen key is independent,
 * malformed payloads decode to `{}`, partial writes preserve the
 * other timestamp, and `resetAllTourState` only touches keys under
 * the `effect-clue.tour.` prefix.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DateTime } from "effect";
import {
    loadTourState,
    resetAllTourState,
    saveTourDismissed,
    saveTourVisited,
    type ScreenKey,
} from "./TourState";

const screens: ReadonlyArray<ScreenKey> = ["setup", "checklist", "suggest"];

const now = (iso = "2026-04-29T00:00:00Z"): DateTime.Utc =>
    DateTime.makeUnsafe(new Date(iso));

beforeEach(() => {
    window.localStorage.clear();
});

describe("loadTourState", () => {
    test.each(screens)("%s: returns {} when no blob exists", (screen) => {
        expect(loadTourState(screen)).toEqual({});
    });

    test("returns {} for corrupt JSON", () => {
        window.localStorage.setItem(
            "effect-clue.tour.setup.v1",
            "{{{not json",
        );
        expect(loadTourState("setup")).toEqual({});
    });

    test("returns {} when the decoded shape is wrong (missing version)", () => {
        window.localStorage.setItem(
            "effect-clue.tour.setup.v1",
            JSON.stringify({ lastVisitedAt: "x" }),
        );
        expect(loadTourState("setup")).toEqual({});
    });
});

describe("saveTourVisited / saveTourDismissed round-trip", () => {
    test("save visited then load returns the timestamp", () => {
        const t = now();
        saveTourVisited("setup", t);
        const loaded = loadTourState("setup");
        expect(loaded.lastVisitedAt).toBeDefined();
        expect(
            DateTime.toEpochMillis(loaded.lastVisitedAt!),
        ).toBe(DateTime.toEpochMillis(t));
    });

    test("save dismissed merges with prior visited timestamp", () => {
        const visited = now("2026-04-01T00:00:00Z");
        const dismissed = now("2026-04-29T00:00:00Z");
        saveTourVisited("setup", visited);
        saveTourDismissed("setup", dismissed);
        const loaded = loadTourState("setup");
        expect(
            DateTime.toEpochMillis(loaded.lastVisitedAt!),
        ).toBe(DateTime.toEpochMillis(visited));
        expect(
            DateTime.toEpochMillis(loaded.lastDismissedAt!),
        ).toBe(DateTime.toEpochMillis(dismissed));
    });

    test("save swallows quota-exceeded errors silently", () => {
        const spy = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new DOMException("QuotaExceededError");
            });
        expect(() => saveTourVisited("setup", now())).not.toThrow();
        spy.mockRestore();
    });
});

describe("per-screen storage isolation", () => {
    test("dismissing setup does not affect checklist's state", () => {
        const t = now();
        saveTourDismissed("setup", t);
        expect(loadTourState("setup").lastDismissedAt).toBeDefined();
        expect(loadTourState("checklist").lastDismissedAt).toBeUndefined();
    });

    test("each screen writes under its own storage key", () => {
        saveTourVisited("setup", now());
        saveTourVisited("checklist", now());
        expect(
            window.localStorage.getItem("effect-clue.tour.setup.v1"),
        ).not.toBeNull();
        expect(
            window.localStorage.getItem("effect-clue.tour.checklist.v1"),
        ).not.toBeNull();
        expect(
            window.localStorage.getItem("effect-clue.tour.suggest.v1"),
        ).toBeNull();
    });
});

describe("resetAllTourState", () => {
    test("wipes every per-screen tour key", () => {
        for (const s of screens) saveTourVisited(s, now());
        resetAllTourState();
        for (const s of screens) {
            expect(loadTourState(s)).toEqual({});
        }
    });

    test("does NOT touch unrelated localStorage keys", () => {
        saveTourVisited("setup", now());
        // Seed unrelated namespaces.
        window.localStorage.setItem(
            "effect-clue.session.v6",
            JSON.stringify({ version: 6 }),
        );
        window.localStorage.setItem(
            "effect-clue.splash.v1",
            JSON.stringify({ version: 1 }),
        );
        resetAllTourState();
        expect(loadTourState("setup")).toEqual({});
        expect(
            window.localStorage.getItem("effect-clue.session.v6"),
        ).not.toBeNull();
        expect(
            window.localStorage.getItem("effect-clue.splash.v1"),
        ).not.toBeNull();
    });
});
