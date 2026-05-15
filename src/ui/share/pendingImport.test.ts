/**
 * Round-trip tests for the receive-side sign-in intent. The shareId
 * match + age check is the malicious-URL defence: a third party who
 * sends a `/share/[id]` URL has no way to write sessionStorage on the
 * recipient's tab, so an idle visit never auto-imports. These tests
 * pin the corresponding failure modes.
 *
 * The intent shape carries optional `selfPlayerIdData` and
 * `knownCardsData` strings (encoded via the wire-format codecs) so an
 * anonymous user's invite-share picks survive the OAuth round-trip.
 * `consume` returns `null | overrides` rather than a boolean so the
 * caller can apply the picks as `ApplyOverrides`; `peek` does the
 * same lookup without clearing the entry, used by the anonymous-mount
 * restore path when the user navigates back from OAuth mid-flow.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    consumePendingImportIntent,
    peekPendingImportIntent,
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
    test("save → consume with matching shareId returns overrides once", () => {
        savePendingImportIntent({ shareId: "share_abc", t: Date.now() });
        // First consume returns the (empty) override bag — the intent
        // existed without encoded picks.
        expect(consumePendingImportIntent("share_abc")).toEqual({});
        // Single-use: a second consume returns null even with the
        // same shareId.
        expect(consumePendingImportIntent("share_abc")).toBeNull();
    });

    test("consume always clears the entry, even on shareId mismatch", () => {
        savePendingImportIntent({ shareId: "share_abc", t: Date.now() });
        // Mismatched shareId → null AND the entry is gone, so a
        // subsequent legitimate consume can't pick it up either.
        expect(consumePendingImportIntent("share_xyz")).toBeNull();
        expect(sessionStorage.getItem(KEY)).toBeNull();
        expect(consumePendingImportIntent("share_abc")).toBeNull();
    });

    test("stale intent (older than 10 minutes) → null and cleared", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
        savePendingImportIntent({
            shareId: "share_abc",
            t: Date.now(),
        });
        // Advance 11 minutes.
        vi.setSystemTime(new Date(2026, 0, 1, 12, 11, 0));
        expect(consumePendingImportIntent("share_abc")).toBeNull();
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
        expect(consumePendingImportIntent("share_abc")).toBeNull();
    });

    test("malformed sessionStorage value → null", () => {
        sessionStorage.setItem(KEY, "not-json");
        expect(consumePendingImportIntent("share_abc")).toBeNull();
    });

    test("missing required fields → null", () => {
        sessionStorage.setItem(KEY, JSON.stringify({ shareId: 123, t: 1 }));
        expect(consumePendingImportIntent("share_abc")).toBeNull();
    });

    test("no intent stored → null (malicious URL safe path)", () => {
        // The default state for any drive-by visit to a /share/[id]
        // URL — no auto-import. The receive page renders the modal
        // and waits for explicit user action.
        expect(consumePendingImportIntent("share_abc")).toBeNull();
    });

    test("intent with encoded picks round-trips through consume", () => {
        // Stores the user's invite-share picker selections so the OAuth
        // round-trip preserves them. The codec strings are opaque here
        // — pendingImport doesn't decode them, just shuttles them.
        savePendingImportIntent({
            shareId: "share_abc",
            t: Date.now(),
            selfPlayerIdData: '"player-alice"',
            knownCardsData:
                '[{"player":"player-alice","cards":["card-knife"]}]',
        });
        expect(consumePendingImportIntent("share_abc")).toEqual({
            selfPlayerIdData: '"player-alice"',
            knownCardsData:
                '[{"player":"player-alice","cards":["card-knife"]}]',
        });
    });

    test("intent with partial picks (identity only) preserves only that field", () => {
        savePendingImportIntent({
            shareId: "share_abc",
            t: Date.now(),
            selfPlayerIdData: '"player-alice"',
        });
        expect(consumePendingImportIntent("share_abc")).toEqual({
            selfPlayerIdData: '"player-alice"',
        });
    });

    test("intent with wrong-type override field is rejected as malformed", () => {
        // Defensive: if a stored entry has a non-string override field
        // (someone tampered with sessionStorage, or a future shape we
        // can't parse), reject the whole entry rather than partially
        // applying.
        sessionStorage.setItem(
            KEY,
            JSON.stringify({
                shareId: "share_abc",
                t: Date.now(),
                selfPlayerIdData: 42,
            }),
        );
        expect(consumePendingImportIntent("share_abc")).toBeNull();
    });
});

describe("peekPendingImportIntent", () => {
    test("returns overrides without clearing the entry", () => {
        savePendingImportIntent({
            shareId: "share_abc",
            t: Date.now(),
            selfPlayerIdData: '"player-alice"',
        });
        // Peek once: gets the overrides, entry still in storage.
        expect(peekPendingImportIntent("share_abc")).toEqual({
            selfPlayerIdData: '"player-alice"',
        });
        expect(sessionStorage.getItem(KEY)).not.toBeNull();
        // Peek again: same result, still not cleared.
        expect(peekPendingImportIntent("share_abc")).toEqual({
            selfPlayerIdData: '"player-alice"',
        });
        expect(sessionStorage.getItem(KEY)).not.toBeNull();
        // Consume now clears.
        expect(consumePendingImportIntent("share_abc")).toEqual({
            selfPlayerIdData: '"player-alice"',
        });
        expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    test("shareId mismatch → null and entry preserved", () => {
        savePendingImportIntent({ shareId: "share_abc", t: Date.now() });
        expect(peekPendingImportIntent("share_xyz")).toBeNull();
        expect(sessionStorage.getItem(KEY)).not.toBeNull();
    });

    test("stale intent → null", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
        savePendingImportIntent({ shareId: "share_abc", t: Date.now() });
        vi.setSystemTime(new Date(2026, 0, 1, 12, 11, 0));
        expect(peekPendingImportIntent("share_abc")).toBeNull();
    });

    test("no intent stored → null", () => {
        expect(peekPendingImportIntent("share_abc")).toBeNull();
    });
});
