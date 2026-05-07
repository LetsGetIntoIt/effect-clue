/**
 * Round-trip tests for the receive-side sign-in intent. The shareId
 * match + age check is the malicious-URL defence: a third party who
 * sends a `/share/[id]` URL has no way to write sessionStorage on the
 * recipient's tab, so an idle visit never auto-imports. These tests
 * pin the corresponding failure modes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    consumePendingImportIntent,
    savePendingImportIntent,
} from "./pendingImport";

const KEY = "effect-clue.pending-import.v1";

beforeEach(() => {
    sessionStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("savePendingImportIntent / consumePendingImportIntent", () => {
    test("save → consume with matching shareId returns true once", () => {
        savePendingImportIntent({ shareId: "share_abc", t: Date.now() });
        expect(consumePendingImportIntent("share_abc")).toBe(true);
        // Single-use: a second consume returns false even with the
        // same shareId.
        expect(consumePendingImportIntent("share_abc")).toBe(false);
    });

    test("consume always clears the entry, even on shareId mismatch", () => {
        savePendingImportIntent({ shareId: "share_abc", t: Date.now() });
        // Mismatched shareId → false AND the entry is gone, so a
        // subsequent legitimate consume can't pick it up either.
        expect(consumePendingImportIntent("share_xyz")).toBe(false);
        expect(sessionStorage.getItem(KEY)).toBeNull();
        expect(consumePendingImportIntent("share_abc")).toBe(false);
    });

    test("stale intent (older than 10 minutes) → false and cleared", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
        savePendingImportIntent({
            shareId: "share_abc",
            t: Date.now(),
        });
        // Advance 11 minutes.
        vi.setSystemTime(new Date(2026, 0, 1, 12, 11, 0));
        expect(consumePendingImportIntent("share_abc")).toBe(false);
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    test("intent with future timestamp (clock skew) → rejected", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
        // Save an entry stamped at "now + 1 minute" — defends against
        // a malformed sessionStorage value tricking us into accepting.
        sessionStorage.setItem(
            KEY,
            JSON.stringify({
                shareId: "share_abc",
                t: Date.now() + 60_000,
            }),
        );
        expect(consumePendingImportIntent("share_abc")).toBe(false);
    });

    test("malformed sessionStorage value → false", () => {
        sessionStorage.setItem(KEY, "not-json");
        expect(consumePendingImportIntent("share_abc")).toBe(false);
    });

    test("missing required fields → false", () => {
        sessionStorage.setItem(KEY, JSON.stringify({ shareId: 123, t: 1 }));
        expect(consumePendingImportIntent("share_abc")).toBe(false);
    });

    test("no intent stored → false (malicious URL safe path)", () => {
        // The default state for any drive-by visit to a /share/[id]
        // URL — no auto-import. The receive page renders the modal
        // and waits for explicit user action.
        expect(consumePendingImportIntent("share_abc")).toBe(false);
    });
});
