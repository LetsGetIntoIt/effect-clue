import { describe, expect, test } from "vitest";
import { DateTime, Duration, Effect } from "effect";
import {
    ABOUT_APP_SPLASH_SCREEN_DISMISSAL_DURATION,
    computeShouldShowSplash,
} from "./useSplashGate";

const runGate = (
    state: Parameters<typeof computeShouldShowSplash>[0],
    now: DateTime.Utc,
    duration: Duration.Duration = ABOUT_APP_SPLASH_SCREEN_DISMISSAL_DURATION,
): boolean => Effect.runSync(computeShouldShowSplash(state, now, duration));

const at = (iso: string): DateTime.Utc => DateTime.makeUnsafe(iso);

describe("computeShouldShowSplash", () => {
    test("first visit ever → show", () => {
        expect(runGate({}, at("2026-04-25T00:00:00Z"))).toBe(true);
    });

    test("returning, never opted out → show every time", () => {
        const now = at("2026-04-25T00:00:00Z");
        const lastVisitedAt = at("2026-04-24T23:00:00Z"); // 1h ago
        expect(runGate({ lastVisitedAt }, now)).toBe(true);
    });

    test("opted out and visited recently → hide", () => {
        const now = at("2026-04-25T00:00:00Z");
        const lastVisitedAt = at("2026-04-24T00:00:00Z"); // 1d ago
        const lastDismissedAt = at("2026-04-23T00:00:00Z");
        expect(runGate({ lastVisitedAt, lastDismissedAt }, now)).toBe(false);
    });

    test("opted out but away > DURATION → show again (re-engagement)", () => {
        const now = at("2026-04-25T00:00:00Z");
        const lastVisitedAt = at("2026-02-01T00:00:00Z"); // ~12 weeks ago
        const lastDismissedAt = at("2026-01-15T00:00:00Z");
        expect(runGate({ lastVisitedAt, lastDismissedAt }, now)).toBe(true);
    });

    test("opted out and away exactly DURATION → still hide (strict greaterThan)", () => {
        const now = at("2026-04-25T00:00:00Z");
        const lastVisitedAt = DateTime.subtract(now, { weeks: 4 });
        const lastDismissedAt = at("2026-01-01T00:00:00Z");
        expect(runGate({ lastVisitedAt, lastDismissedAt }, now)).toBe(false);
    });

    test("opted out, lastVisitedAt missing (defensive) → show", () => {
        // Should not happen in practice — once you've dismissed you've
        // visited at least once — but the gate stays safe rather than
        // crashing if the storage somehow gets into this state.
        const now = at("2026-04-25T00:00:00Z");
        const lastDismissedAt = at("2026-01-01T00:00:00Z");
        expect(runGate({ lastDismissedAt }, now)).toBe(true);
    });

    test("custom duration is honored", () => {
        const now = at("2026-04-25T00:00:00Z");
        const lastVisitedAt = at("2026-04-23T00:00:00Z"); // 2d ago
        const lastDismissedAt = at("2026-04-20T00:00:00Z");
        // 1-day duration: 2d > 1d → show
        expect(
            runGate(
                { lastVisitedAt, lastDismissedAt },
                now,
                Duration.days(1),
            ),
        ).toBe(true);
        // 1-week duration: 2d < 1w → hide
        expect(
            runGate(
                { lastVisitedAt, lastDismissedAt },
                now,
                Duration.weeks(1),
            ),
        ).toBe(false);
    });
});
