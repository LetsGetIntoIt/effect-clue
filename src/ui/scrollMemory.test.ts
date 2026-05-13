import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    consumeScrollRestoreSuppression,
    getScroll,
    recordScroll,
    resetScrollMemory,
    suppressNextScrollRestore,
    touchScrollMemory,
} from "./scrollMemory";

beforeEach(() => {
    resetScrollMemory();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("scrollMemory", () => {
    test("starts at 0 for every uiMode", () => {
        expect(getScroll("setup")).toBe(0);
        expect(getScroll("checklist")).toBe(0);
        expect(getScroll("suggest")).toBe(0);
    });

    test("recordScroll writes the value into the slot for that uiMode", () => {
        recordScroll("checklist", 420);
        expect(getScroll("checklist")).toBe(420);
    });

    test("slots are independent — writing one doesn't touch the others", () => {
        recordScroll("checklist", 420);
        expect(getScroll("setup")).toBe(0);
        expect(getScroll("suggest")).toBe(0);
    });

    test("resetScrollMemory zeroes every slot", () => {
        recordScroll("setup", 100);
        recordScroll("checklist", 200);
        recordScroll("suggest", 300);
        resetScrollMemory();
        expect(getScroll("setup")).toBe(0);
        expect(getScroll("checklist")).toBe(0);
        expect(getScroll("suggest")).toBe(0);
    });

    test("recordScroll overwrites the previous value", () => {
        recordScroll("suggest", 50);
        recordScroll("suggest", 75);
        expect(getScroll("suggest")).toBe(75);
    });
});

describe("scrollMemory TTL", () => {
    test("returns 0 after more than 2 minutes since last visit", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(1_700_000_000_000));
        recordScroll("checklist", 200);
        // Advance 2 minutes and 1 second past TTL.
        vi.setSystemTime(new Date(1_700_000_000_000 + 121 * 1000));
        expect(getScroll("checklist")).toBe(0);
    });

    test("returns the saved y when within 2 minutes", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(1_700_000_000_000));
        recordScroll("checklist", 200);
        vi.setSystemTime(new Date(1_700_000_000_000 + 90 * 1000));
        expect(getScroll("checklist")).toBe(200);
    });

    test("touchScrollMemory keeps a slot alive without changing y", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(1_700_000_000_000));
        recordScroll("checklist", 200);
        // 1 minute later, touch (extends the visit window).
        vi.setSystemTime(new Date(1_700_000_000_000 + 60 * 1000));
        touchScrollMemory("checklist");
        // 1.5 minutes after the touch is still within TTL of the touch
        // even though it's 2.5 minutes after the original recordScroll.
        vi.setSystemTime(new Date(1_700_000_000_000 + 60 * 1000 + 90 * 1000));
        expect(getScroll("checklist")).toBe(200);
    });

    test("a slot never written returns 0 regardless of time", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(1_700_000_000_000));
        expect(getScroll("setup")).toBe(0);
        vi.setSystemTime(new Date(1_700_000_000_000 + 600 * 1000));
        expect(getScroll("setup")).toBe(0);
    });

    test("resetScrollMemory clears lastVisitedAt so expiry restarts cleanly", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(1_700_000_000_000));
        recordScroll("checklist", 200);
        resetScrollMemory();
        // A fresh recordScroll at the SAME wall-clock time should be
        // valid for the next 2 minutes — reset doesn't poison the slot.
        recordScroll("checklist", 300);
        expect(getScroll("checklist")).toBe(300);
    });
});

describe("scrollMemory suppression", () => {
    test("consume returns true once after suppress, false thereafter", () => {
        suppressNextScrollRestore("suggest");
        expect(consumeScrollRestoreSuppression("suggest")).toBe(true);
        expect(consumeScrollRestoreSuppression("suggest")).toBe(false);
    });

    test("consume returns false when no suppression is pending", () => {
        expect(consumeScrollRestoreSuppression("checklist")).toBe(false);
    });

    test("suppression is per-mode — suggest does not affect checklist", () => {
        suppressNextScrollRestore("suggest");
        expect(consumeScrollRestoreSuppression("checklist")).toBe(false);
        expect(consumeScrollRestoreSuppression("suggest")).toBe(true);
    });

    test("suppression does not clobber the saved y", () => {
        recordScroll("suggest", 420);
        suppressNextScrollRestore("suggest");
        // Caller is expected to skip the restore when consume returns
        // true. The saved y stays available for the next non-
        // suppressed call.
        expect(consumeScrollRestoreSuppression("suggest")).toBe(true);
        expect(getScroll("suggest")).toBe(420);
    });

    test("resetScrollMemory clears pending suppressions", () => {
        suppressNextScrollRestore("suggest");
        suppressNextScrollRestore("checklist");
        resetScrollMemory();
        expect(consumeScrollRestoreSuppression("suggest")).toBe(false);
        expect(consumeScrollRestoreSuppression("checklist")).toBe(false);
    });
});
