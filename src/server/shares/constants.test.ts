/**
 * Locks in the M17 user-confirmed share lifetime so a future
 * change has to update both the constant and this assertion in
 * lockstep — surfacing the change in code review.
 */
import { describe, expect, test } from "vitest";
import { Duration } from "effect";
import { SHARE_TTL } from "./constants";

describe("SHARE_TTL", () => {
    test("is 24 hours, the user-confirmed expiry duration", () => {
        expect(Duration.toHours(SHARE_TTL)).toBe(24);
    });

    test("converts to a positive integer hour count for SQL INTERVAL binding", () => {
        const hours = Math.floor(Duration.toHours(SHARE_TTL));
        expect(hours).toBeGreaterThan(0);
        expect(Number.isInteger(hours)).toBe(true);
    });
});
