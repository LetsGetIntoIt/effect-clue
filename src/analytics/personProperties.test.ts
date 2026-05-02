/**
 * Tests for the person-properties helper. Pins the empty-bag drop
 * (so spread-into-payload doesn't bloat the wire format with
 * `$set: {}`) and the ISO conversion at the DateTime → string edge.
 */
import { describe, expect, test } from "vitest";
import { DateTime } from "effect";
import { personIso, withPersonProperties } from "./personProperties";

describe("withPersonProperties", () => {
    test("returns an empty object when both bags are missing", () => {
        expect(withPersonProperties()).toEqual({});
    });

    test("returns an empty object when both bags are empty", () => {
        expect(withPersonProperties({}, {})).toEqual({});
    });

    test("includes $set when set has at least one key", () => {
        expect(withPersonProperties({ a: 1 })).toEqual({
            $set: { a: 1 },
        });
    });

    test("includes $set_once when only setOnce is provided", () => {
        expect(withPersonProperties(undefined, { first_seen: "x" })).toEqual({
            $set_once: { first_seen: "x" },
        });
    });

    test("includes both keys when both bags have entries", () => {
        expect(
            withPersonProperties(
                { status: "ready" },
                { first_at: "2026-01-01T00:00:00.000Z" },
            ),
        ).toEqual({
            $set: { status: "ready" },
            $set_once: { first_at: "2026-01-01T00:00:00.000Z" },
        });
    });

    test("drops an empty $set even if setOnce has entries", () => {
        expect(
            withPersonProperties({}, { first_at: "x" }),
        ).toEqual({ $set_once: { first_at: "x" } });
    });
});

describe("personIso", () => {
    test("formats a DateTime.Utc as an ISO-8601 string", () => {
        const dt = DateTime.makeUnsafe("2026-04-25T12:34:56.789Z");
        expect(personIso(dt)).toBe("2026-04-25T12:34:56.789Z");
    });
});
