import { afterEach, describe, expect, test } from "vitest";
import { DateTime, Duration } from "effect";
import {
    clearGameLifecycle,
    isStaleGameEligible,
    loadGameLifecycleState,
    markGameCreated,
    markGameTouched,
    markStaleGameSnoozed,
    STALE_GAME_SNOOZE,
    STALE_GAME_THRESHOLD_STARTED,
    STALE_GAME_THRESHOLD_UNSTARTED,
} from "./GameLifecycleState";

const STORAGE_KEY = "effect-clue.gameLifecycle.v1";

afterEach(() => {
    window.localStorage.clear();
});

describe("GameLifecycleState", () => {
    test("returns empty state when nothing is stored", () => {
        expect(loadGameLifecycleState()).toEqual({});
    });

    test("returns empty state when payload is malformed", () => {
        window.localStorage.setItem(STORAGE_KEY, "not json");
        expect(loadGameLifecycleState()).toEqual({});
    });

    test("returns empty state when schema rejects payload", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 99, createdAt: "garbage" }),
        );
        expect(loadGameLifecycleState()).toEqual({});
    });

    test("markGameCreated sets createdAt and lastModifiedAt", () => {
        const now = DateTime.makeUnsafe("2026-04-25T12:00:00Z");
        markGameCreated(now);
        const state = loadGameLifecycleState();
        expect(state.createdAt).toEqual(now);
        expect(state.lastModifiedAt).toEqual(now);
        expect(state.lastSnoozedAt).toBeUndefined();
    });

    test("markGameCreated clears a prior snooze", () => {
        const snoozeAt = DateTime.makeUnsafe("2026-04-20T00:00:00Z");
        const createdAt = DateTime.makeUnsafe("2026-04-25T00:00:00Z");
        markStaleGameSnoozed(snoozeAt);
        markGameCreated(createdAt);
        const state = loadGameLifecycleState();
        expect(state.lastSnoozedAt).toBeUndefined();
        expect(state.createdAt).toEqual(createdAt);
    });

    test("markGameTouched bumps lastModifiedAt without clobbering createdAt", () => {
        const createdAt = DateTime.makeUnsafe("2026-04-20T00:00:00Z");
        const touchedAt = DateTime.makeUnsafe("2026-04-25T12:00:00Z");
        markGameCreated(createdAt);
        markGameTouched(touchedAt);
        const state = loadGameLifecycleState();
        expect(state.createdAt).toEqual(createdAt);
        expect(state.lastModifiedAt).toEqual(touchedAt);
    });

    test("markStaleGameSnoozed records the snooze without touching the rest", () => {
        const createdAt = DateTime.makeUnsafe("2026-04-20T00:00:00Z");
        const touchedAt = DateTime.makeUnsafe("2026-04-21T00:00:00Z");
        const snoozedAt = DateTime.makeUnsafe("2026-04-25T00:00:00Z");
        markGameCreated(createdAt);
        markGameTouched(touchedAt);
        markStaleGameSnoozed(snoozedAt);
        const state = loadGameLifecycleState();
        expect(state.createdAt).toEqual(createdAt);
        expect(state.lastModifiedAt).toEqual(touchedAt);
        expect(state.lastSnoozedAt).toEqual(snoozedAt);
    });

    test("clearGameLifecycle wipes the storage key", () => {
        markGameCreated(DateTime.makeUnsafe("2026-04-20T00:00:00Z"));
        clearGameLifecycle();
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(loadGameLifecycleState()).toEqual({});
    });
});

describe("isStaleGameEligible", () => {
    const now = DateTime.makeUnsafe("2026-04-25T12:00:00Z");

    test("returns false on an empty state regardless of started flag", () => {
        expect(
            isStaleGameEligible({ state: {}, gameStarted: false, now }),
        ).toBe(false);
        expect(
            isStaleGameEligible({ state: {}, gameStarted: true, now }),
        ).toBe(false);
    });

    test("started game: fires when idle longer than the started threshold", () => {
        const lastModifiedAt = DateTime.subtractDuration(
            now,
            Duration.sum(STALE_GAME_THRESHOLD_STARTED, Duration.minutes(1)),
        );
        expect(
            isStaleGameEligible({
                state: { lastModifiedAt },
                gameStarted: true,
                now,
            }),
        ).toBe(true);
    });

    test("started game: does NOT fire within the started threshold", () => {
        const lastModifiedAt = DateTime.subtractDuration(
            now,
            Duration.minutes(5),
        );
        expect(
            isStaleGameEligible({
                state: { lastModifiedAt },
                gameStarted: true,
                now,
            }),
        ).toBe(false);
    });

    test("unstarted game: fires when older than the unstarted threshold", () => {
        const createdAt = DateTime.subtractDuration(
            now,
            Duration.sum(STALE_GAME_THRESHOLD_UNSTARTED, Duration.minutes(1)),
        );
        expect(
            isStaleGameEligible({
                state: { createdAt },
                gameStarted: false,
                now,
            }),
        ).toBe(true);
    });

    test("unstarted game: does NOT fire within the unstarted threshold", () => {
        const createdAt = DateTime.subtractDuration(
            now,
            Duration.minutes(5),
        );
        expect(
            isStaleGameEligible({
                state: { createdAt },
                gameStarted: false,
                now,
            }),
        ).toBe(false);
    });

    test("snoozed within window: never fires regardless of age", () => {
        const lastModifiedAt = DateTime.subtractDuration(
            now,
            Duration.weeks(4),
        );
        const lastSnoozedAt = DateTime.subtractDuration(
            now,
            Duration.hours(1),
        );
        expect(
            isStaleGameEligible({
                state: { lastModifiedAt, lastSnoozedAt },
                gameStarted: true,
                now,
            }),
        ).toBe(false);
    });

    test("snooze older than window: gate falls back to age check", () => {
        const lastModifiedAt = DateTime.subtractDuration(
            now,
            Duration.weeks(4),
        );
        const lastSnoozedAt = DateTime.subtractDuration(
            now,
            Duration.sum(STALE_GAME_SNOOZE, Duration.minutes(1)),
        );
        expect(
            isStaleGameEligible({
                state: { lastModifiedAt, lastSnoozedAt },
                gameStarted: true,
                now,
            }),
        ).toBe(true);
    });
});
