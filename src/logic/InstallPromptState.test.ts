/**
 * Storage + gate tests for the PWA install prompt. Pure-Effect
 * gate logic + localStorage round-trip; the React hook side
 * (`useInstallPrompt`) integrates these and is harder to unit-test
 * because it depends on the browser's `beforeinstallprompt` event.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DateTime, Duration } from "effect";
import {
    INSTALL_PROMPT_MIN_VISITS,
    INSTALL_PROMPT_SNOOZE_DURATION,
    computeShouldShowInstallPrompt,
    loadInstallPromptState,
    recordInstallPromptDismissed,
    recordInstallPromptShown,
    recordInstallPromptVisit,
} from "./InstallPromptState";

const STORAGE_KEY = "effect-clue.install-prompt.v1";
const now = (iso: string): DateTime.Utc => DateTime.makeUnsafe(new Date(iso));

beforeEach(() => {
    window.localStorage.clear();
});

describe("loadInstallPromptState", () => {
    test("returns { visits: 0 } when no blob exists", () => {
        expect(loadInstallPromptState()).toEqual({ visits: 0 });
    });

    test("returns { visits: 0 } for corrupt JSON", () => {
        window.localStorage.setItem(STORAGE_KEY, "{{{not json");
        expect(loadInstallPromptState()).toEqual({ visits: 0 });
    });

    test("returns { visits: 0 } when the version is wrong", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 99, visits: 5 }),
        );
        expect(loadInstallPromptState()).toEqual({ visits: 0 });
    });

    test("decodes a well-formed v1 blob with visits + timestamps", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: 1,
                visits: 3,
                lastShownAt: "2026-04-29T00:00:00.000Z",
                lastDismissedAt: "2026-04-29T01:00:00.000Z",
            }),
        );
        const loaded = loadInstallPromptState();
        expect(loaded.visits).toBe(3);
        expect(loaded.lastShownAt).toBeDefined();
        expect(loaded.lastDismissedAt).toBeDefined();
    });
});

describe("recordInstallPromptVisit", () => {
    test("increments visits from 0 to 1 on first call", () => {
        recordInstallPromptVisit();
        expect(loadInstallPromptState().visits).toBe(1);
    });

    test("increments cumulatively on repeated calls", () => {
        recordInstallPromptVisit();
        recordInstallPromptVisit();
        recordInstallPromptVisit();
        expect(loadInstallPromptState().visits).toBe(3);
    });

    test("save swallows quota errors silently", () => {
        const spy = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new DOMException("QuotaExceededError");
            });
        expect(() => recordInstallPromptVisit()).not.toThrow();
        spy.mockRestore();
    });
});

describe("recordInstallPromptShown / Dismissed", () => {
    test("recordShown sets lastShownAt without clearing visits", () => {
        recordInstallPromptVisit();
        recordInstallPromptVisit();
        recordInstallPromptShown(now("2026-04-29T00:00:00Z"));
        const loaded = loadInstallPromptState();
        expect(loaded.visits).toBe(2);
        expect(loaded.lastShownAt).toBeDefined();
    });

    test("recordDismissed sets lastDismissedAt without clearing the rest", () => {
        recordInstallPromptVisit();
        recordInstallPromptShown(now("2026-04-29T00:00:00Z"));
        recordInstallPromptDismissed(now("2026-04-29T01:00:00Z"));
        const loaded = loadInstallPromptState();
        expect(loaded.visits).toBe(1);
        expect(loaded.lastShownAt).toBeDefined();
        expect(loaded.lastDismissedAt).toBeDefined();
    });
});

describe("computeShouldShowInstallPrompt", () => {
    const t = now("2026-04-29T00:00:00Z");

    test("does not show with fewer visits than the minimum", () => {
        expect(
            computeShouldShowInstallPrompt(
                { visits: 1 },
                t,
                INSTALL_PROMPT_SNOOZE_DURATION,
                INSTALL_PROMPT_MIN_VISITS,
            ),
        ).toBe(false);
    });

    test("shows on the visit that hits the minimum", () => {
        expect(
            computeShouldShowInstallPrompt(
                { visits: INSTALL_PROMPT_MIN_VISITS },
                t,
                INSTALL_PROMPT_SNOOZE_DURATION,
                INSTALL_PROMPT_MIN_VISITS,
            ),
        ).toBe(true);
    });

    test("does NOT show within the snooze window after a dismiss", () => {
        const dismissed = DateTime.subtractDuration(t, Duration.minutes(5));
        expect(
            computeShouldShowInstallPrompt(
                {
                    visits: 5,
                    lastDismissedAt: dismissed,
                },
                t,
            ),
        ).toBe(false);
    });

    test("re-engages after the snooze window has elapsed", () => {
        const dismissed = DateTime.subtractDuration(t, Duration.weeks(6));
        expect(
            computeShouldShowInstallPrompt(
                {
                    visits: 5,
                    lastDismissedAt: dismissed,
                },
                t,
            ),
        ).toBe(true);
    });

    test("`INSTALL_PROMPT_MIN_VISITS` defaults to 2 (the plan's '2nd visit' rule)", () => {
        expect(INSTALL_PROMPT_MIN_VISITS).toBe(2);
    });

    test("`INSTALL_PROMPT_SNOOZE_DURATION` defaults to 4 weeks", () => {
        expect(
            Duration.equals(INSTALL_PROMPT_SNOOZE_DURATION, Duration.weeks(4)),
        ).toBe(true);
    });
});
