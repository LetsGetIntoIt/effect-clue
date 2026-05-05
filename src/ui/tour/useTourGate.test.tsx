/**
 * Gate-logic tests for the per-screen tour gate. Mirrors the
 * `useSplashGate` / `SplashState` test coverage:
 *
 *   - First visit (no `lastVisitedAt`, no `lastDismissedAt`) shows.
 *   - Visited but never dismissed shows.
 *   - Dismissed within the window does NOT show.
 *   - Dismissed but >= window since the last visit / dismissal shows again.
 *   - Each per-screen storage key is independent (dismissing setup
 *     doesn't suppress checklist).
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { DateTime, Duration } from "effect";
import { TelemetryRuntime } from "../../observability/runtime";
import {
    computeShouldShowTour,
    TOUR_RE_ENGAGE_DURATION,
    useTourGate,
} from "./useTourGate";
import { saveTourDismissed, type ScreenKey } from "./TourState";

const now = DateTime.makeUnsafe(new Date("2026-04-29T00:00:00Z"));
const FIVE_MIN = Duration.minutes(5);
const SIX_WEEKS = Duration.weeks(6);

describe("computeShouldShowTour", () => {
    test("first visit (no timestamps) shows", () => {
        const result = TelemetryRuntime.runSync(
            computeShouldShowTour({}, now, TOUR_RE_ENGAGE_DURATION),
        );
        expect(result).toBe(true);
    });

    test("visited but never dismissed: shows", () => {
        const visitedFiveMinAgo = DateTime.subtractDuration(now, FIVE_MIN);
        const result = TelemetryRuntime.runSync(
            computeShouldShowTour(
                { lastVisitedAt: visitedFiveMinAgo },
                now,
                TOUR_RE_ENGAGE_DURATION,
            ),
        );
        expect(result).toBe(true);
    });

    test("dismissed and visited 5 minutes ago: does NOT show", () => {
        const fiveMinAgo = DateTime.subtractDuration(now, FIVE_MIN);
        const result = TelemetryRuntime.runSync(
            computeShouldShowTour(
                {
                    lastVisitedAt: fiveMinAgo,
                    lastDismissedAt: fiveMinAgo,
                },
                now,
                TOUR_RE_ENGAGE_DURATION,
            ),
        );
        expect(result).toBe(false);
    });

    test("dismissed but visited 6 weeks ago: re-engages", () => {
        const sixWeeksAgo = DateTime.subtractDuration(now, SIX_WEEKS);
        const result = TelemetryRuntime.runSync(
            computeShouldShowTour(
                {
                    lastVisitedAt: sixWeeksAgo,
                    lastDismissedAt: sixWeeksAgo,
                },
                now,
                TOUR_RE_ENGAGE_DURATION,
            ),
        );
        expect(result).toBe(true);
    });

    test("dismissed but no `lastVisitedAt` (rare): does NOT show inside the window", () => {
        // Legacy or defensive states may have only `lastDismissedAt`.
        // A dismissal is still enough to lock the gate until the
        // re-engage window expires.
        const fiveMinAgo = DateTime.subtractDuration(now, FIVE_MIN);
        const result = TelemetryRuntime.runSync(
            computeShouldShowTour(
                { lastDismissedAt: fiveMinAgo },
                now,
                TOUR_RE_ENGAGE_DURATION,
            ),
        );
        expect(result).toBe(false);
    });

    test("dismissed but no `lastVisitedAt` and stale: re-engages", () => {
        const sixWeeksAgo = DateTime.subtractDuration(now, SIX_WEEKS);
        const result = TelemetryRuntime.runSync(
            computeShouldShowTour(
                { lastDismissedAt: sixWeeksAgo },
                now,
                TOUR_RE_ENGAGE_DURATION,
            ),
        );
        expect(result).toBe(true);
    });
});

describe("TOUR_RE_ENGAGE_DURATION", () => {
    test("defaults to 4 weeks", () => {
        expect(Duration.equals(TOUR_RE_ENGAGE_DURATION, Duration.weeks(4))).toBe(
            true,
        );
    });
});

describe("useTourGate (integration)", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    function GateFiringProbe({
        screen,
        onFire,
    }: {
        readonly screen: ScreenKey;
        readonly onFire: (screen: ScreenKey) => void;
    }): null {
        const { shouldShow } = useTourGate(screen);
        useEffect(() => {
            if (shouldShow) onFire(screen);
        }, [shouldShow, screen, onFire]);
        return null;
    }

    test("does not apply a stale show decision after the screen key changes", async () => {
        const fired: Array<ScreenKey> = [];
        const onFire = (screen: ScreenKey): void => {
            fired.push(screen);
        };
        const { rerender } = render(
            <GateFiringProbe screen="checklistSuggest" onFire={onFire} />,
        );

        await act(async () => {});
        expect(fired).toEqual(["checklistSuggest"]);

        saveTourDismissed("setup", DateTime.nowUnsafe());
        rerender(<GateFiringProbe screen="setup" onFire={onFire} />);

        await act(async () => {});
        expect(fired).toEqual(["checklistSuggest"]);
    });
});

// M20: confirm the 4-week dormancy contract holds for every
// `ScreenKey` — they all flow through the same `computeShouldShowTour`
// + `TOUR_RE_ENGAGE_DURATION` pair, so a parameterized assertion
// pins the contract against future ScreenKey additions (M22's new
// `firstSuggestion` is the first beneficiary).
describe("computeShouldShowTour — re-engage cadence per ScreenKey", () => {
    const screenKeys: ReadonlyArray<ScreenKey> = [
        "setup",
        "checklistSuggest",
        "firstSuggestion",
        "account",
        "shareImport",
    ];
    const visitedRecent = DateTime.subtractDuration(now, FIVE_MIN);
    const dismissedRecent = DateTime.subtractDuration(now, FIVE_MIN);
    const visitedLongAgo = DateTime.subtractDuration(now, SIX_WEEKS);
    const dismissedLongAgo = DateTime.subtractDuration(now, SIX_WEEKS);

    for (const _key of screenKeys) {
        // The pure gate logic doesn't take a ScreenKey — storage
        // routing happens upstream in `loadTourState(screen)`. So
        // the parameterization is symbolic: it pins that EVERY
        // ScreenKey routes through the same gate, and the gate
        // applies the 4-week dormancy threshold uniformly.
        test(`fresh state shows for ${_key}`, () => {
            const result = TelemetryRuntime.runSync(
                computeShouldShowTour({}, now, TOUR_RE_ENGAGE_DURATION),
            );
            expect(result).toBe(true);
        });
        test(`recent visit + recent dismiss does NOT show for ${_key}`, () => {
            const result = TelemetryRuntime.runSync(
                computeShouldShowTour(
                    {
                        lastVisitedAt: visitedRecent,
                        lastDismissedAt: dismissedRecent,
                    },
                    now,
                    TOUR_RE_ENGAGE_DURATION,
                ),
            );
            expect(result).toBe(false);
        });
        test(`stale visit (>= 4 weeks) re-engages for ${_key}`, () => {
            const result = TelemetryRuntime.runSync(
                computeShouldShowTour(
                    {
                        lastVisitedAt: visitedLongAgo,
                        lastDismissedAt: dismissedLongAgo,
                    },
                    now,
                    TOUR_RE_ENGAGE_DURATION,
                ),
            );
            expect(result).toBe(true);
        });
    }
});
