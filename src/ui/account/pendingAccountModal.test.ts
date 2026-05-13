/**
 * Unit tests for the "re-open the Account modal after OAuth"
 * sessionStorage handle. Mirrors `pendingImport.test.ts` in shape.
 *
 * The interesting edges are around `consumePendingAccountModalIntent`:
 *   - It must return `true` only when there's a fresh entry.
 *   - It must ALWAYS clear the entry from storage (even on parse
 *     failure / expiry / wrong shape), so a corrupt or stale marker
 *     can't accumulate or trigger a surprise auto-open later.
 *   - Save tolerates `sessionStorage.setItem` throwing — graceful
 *     degradation, not a hard failure.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    consumePendingAccountModalIntent,
    savePendingAccountModalIntent,
} from "./pendingAccountModal";

const KEY = "effect-clue.pending-account-modal.v1";

beforeEach(() => {
    sessionStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("savePendingAccountModalIntent", () => {
    test("writes a JSON-encoded entry with a timestamp", () => {
        const before = Date.now();
        savePendingAccountModalIntent();
        const after = Date.now();
        const raw = sessionStorage.getItem(KEY);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!);
        expect(parsed).toMatchObject({ t: expect.any(Number) });
        expect(parsed.t).toBeGreaterThanOrEqual(before);
        expect(parsed.t).toBeLessThanOrEqual(after);
    });

    test("swallows storage errors so OAuth can still proceed", () => {
        const spy = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("quota exceeded");
            });
        expect(() => savePendingAccountModalIntent()).not.toThrow();
        expect(spy).toHaveBeenCalled();
    });
});

describe("consumePendingAccountModalIntent", () => {
    test("returns false + leaves storage clean when there's no entry", () => {
        expect(consumePendingAccountModalIntent()).toBe(false);
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    test("returns true for a fresh entry", () => {
        savePendingAccountModalIntent();
        expect(consumePendingAccountModalIntent()).toBe(true);
    });

    test("clears the entry from storage after a successful consume", () => {
        savePendingAccountModalIntent();
        consumePendingAccountModalIntent();
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    test("returns false + clears storage when the entry has expired (> 10 min)", () => {
        // Hand-craft an old entry — `Date.now() - 11 minutes`.
        const elevenMinAgo = Date.now() - 11 * 60 * 1000;
        sessionStorage.setItem(KEY, JSON.stringify({ t: elevenMinAgo }));
        expect(consumePendingAccountModalIntent()).toBe(false);
        // Always-clear policy: expired entries are removed too.
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    test("accepts an entry just under the 10-minute window", () => {
        const justUnder = Date.now() - 9 * 60 * 1000;
        sessionStorage.setItem(KEY, JSON.stringify({ t: justUnder }));
        expect(consumePendingAccountModalIntent()).toBe(true);
    });

    test("returns false + clears storage on a future-dated entry (clock skew defense)", () => {
        sessionStorage.setItem(
            KEY,
            JSON.stringify({ t: Date.now() + 5_000 }),
        );
        expect(consumePendingAccountModalIntent()).toBe(false);
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    test("returns false + clears storage when the entry isn't valid JSON", () => {
        sessionStorage.setItem(KEY, "this is not json {");
        expect(consumePendingAccountModalIntent()).toBe(false);
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    test("returns false + clears storage when the entry has the wrong shape", () => {
        sessionStorage.setItem(KEY, JSON.stringify({ wrong: "shape" }));
        expect(consumePendingAccountModalIntent()).toBe(false);
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    test("is single-use — a second consume after a successful one returns false", () => {
        savePendingAccountModalIntent();
        expect(consumePendingAccountModalIntent()).toBe(true);
        expect(consumePendingAccountModalIntent()).toBe(false);
    });
});
