/**
 * Storage-layer tests for per-screen tour state. Each per-screen key
 * is independent, malformed payloads decode to `{}`, partial writes
 * preserve the other timestamp AND the other mode's subkey, and
 * `resetAllTourState` only touches keys under the `effect-clue.tour.`
 * prefix.
 *
 * v2 ↑ v1: a flat persisted record lifts to `{ solve: <flat> }` so
 * pre-check-mode users keep their gate state across the upgrade.
 * v3 ↑ v2: legacy `normal` / `teach` subkeys lift to `solve` / `check`.
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
import type { SolverMode } from "../../logic/ClueState";

const screens: ReadonlyArray<ScreenKey> = ["setup", "checklistSuggest"];

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

    test("v1 record lifts into the `solve` subkey", () => {
        const iso = "2026-04-01T00:00:00Z";
        window.localStorage.setItem(
            "effect-clue.tour.setup.v1",
            JSON.stringify({
                version: 1,
                lastVisitedAt: iso,
                lastDismissedAt: iso,
            }),
        );
        const loaded = loadTourState("setup");
        expect(loaded.solve).toBeDefined();
        expect(loaded.check).toBeUndefined();
        expect(
            DateTime.toEpochMillis(loaded.solve!.lastVisitedAt!),
        ).toBe(DateTime.toEpochMillis(now(iso)));
        expect(
            DateTime.toEpochMillis(loaded.solve!.lastDismissedAt!),
        ).toBe(DateTime.toEpochMillis(now(iso)));
    });

    test("v2 record lifts `normal` → `solve` and `teach` → `check`", () => {
        const iso = "2026-04-01T00:00:00Z";
        window.localStorage.setItem(
            "effect-clue.tour.setup.v1",
            JSON.stringify({
                version: 2,
                normal: { lastVisitedAt: iso, lastDismissedAt: iso },
                teach: { lastVisitedAt: iso },
            }),
        );
        const loaded = loadTourState("setup");
        expect(loaded.solve).toBeDefined();
        expect(loaded.check).toBeDefined();
        expect(
            DateTime.toEpochMillis(loaded.solve!.lastDismissedAt!),
        ).toBe(DateTime.toEpochMillis(now(iso)));
        expect(
            DateTime.toEpochMillis(loaded.check!.lastVisitedAt!),
        ).toBe(DateTime.toEpochMillis(now(iso)));
    });
});

describe("saveTourVisited / saveTourDismissed round-trip", () => {
    test.each<SolverMode>(["solve", "check"])(
        "%s: save visited then load returns the timestamp",
        (mode) => {
            const t = now();
            saveTourVisited("setup", mode, t);
            const loaded = loadTourState("setup")[mode];
            expect(loaded?.lastVisitedAt).toBeDefined();
            expect(
                DateTime.toEpochMillis(loaded!.lastVisitedAt!),
            ).toBe(DateTime.toEpochMillis(t));
        },
    );

    test("save dismissed records the dismissal as the latest visit", () => {
        const visited = now("2026-04-01T00:00:00Z");
        const dismissed = now("2026-04-29T00:00:00Z");
        saveTourVisited("setup", "solve", visited);
        saveTourDismissed("setup", "solve", dismissed);
        const loaded = loadTourState("setup").solve;
        expect(
            DateTime.toEpochMillis(loaded!.lastVisitedAt!),
        ).toBe(DateTime.toEpochMillis(dismissed));
        expect(
            DateTime.toEpochMillis(loaded!.lastDismissedAt!),
        ).toBe(DateTime.toEpochMillis(dismissed));
    });

    test("save dismissed without a prior visit writes both timestamps", () => {
        const dismissed = now("2026-04-29T00:00:00Z");
        saveTourDismissed("setup", "solve", dismissed);
        const loaded = loadTourState("setup").solve;
        expect(
            DateTime.toEpochMillis(loaded!.lastVisitedAt!),
        ).toBe(DateTime.toEpochMillis(dismissed));
        expect(
            DateTime.toEpochMillis(loaded!.lastDismissedAt!),
        ).toBe(DateTime.toEpochMillis(dismissed));
    });

    test("save swallows quota-exceeded errors silently", () => {
        const spy = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new DOMException("QuotaExceededError");
            });
        expect(() =>
            saveTourVisited("setup", "solve", now()),
        ).not.toThrow();
        spy.mockRestore();
    });

    test("writing to one mode preserves the other mode's data", () => {
        const tSolve = now("2026-04-01T00:00:00Z");
        const tCheck = now("2026-04-15T00:00:00Z");
        saveTourDismissed("setup", "solve", tSolve);
        saveTourDismissed("setup", "check", tCheck);
        const loaded = loadTourState("setup");
        expect(
            DateTime.toEpochMillis(loaded.solve!.lastDismissedAt!),
        ).toBe(DateTime.toEpochMillis(tSolve));
        expect(
            DateTime.toEpochMillis(loaded.check!.lastDismissedAt!),
        ).toBe(DateTime.toEpochMillis(tCheck));
    });
});

describe("per-screen storage isolation", () => {
    test("dismissing setup does not affect checklistSuggest's state", () => {
        const t = now();
        saveTourDismissed("setup", "solve", t);
        expect(loadTourState("setup").solve?.lastDismissedAt).toBeDefined();
        expect(
            loadTourState("checklistSuggest").solve?.lastDismissedAt,
        ).toBeUndefined();
    });

    test("each screen writes under its own storage key", () => {
        saveTourVisited("setup", "solve", now());
        saveTourVisited("checklistSuggest", "solve", now());
        expect(
            window.localStorage.getItem("effect-clue.tour.setup.v1"),
        ).not.toBeNull();
        expect(
            window.localStorage.getItem("effect-clue.tour.checklistSuggest.v1"),
        ).not.toBeNull();
        expect(
            window.localStorage.getItem("effect-clue.tour.account.v1"),
        ).toBeNull();
    });
});

describe("resetAllTourState", () => {
    test("wipes every per-screen tour key", () => {
        for (const s of screens) saveTourVisited(s, "solve", now());
        resetAllTourState();
        for (const s of screens) {
            expect(loadTourState(s)).toEqual({});
        }
    });

    test("does NOT touch unrelated localStorage keys", () => {
        saveTourVisited("setup", "solve", now());
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
