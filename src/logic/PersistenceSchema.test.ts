import { describe, expect, test } from "vitest";
import { Result } from "effect";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { decodeSession, encodeSession } from "./Persistence";
import { decodeV5Unknown } from "./PersistenceSchema";
import { Player } from "./GameObjects";

/**
 * The app is pre-production — v5 is the only on-disk format, so
 * there's only one round-trip to cover. Anything that doesn't parse
 * as v5 returns undefined and the caller starts a fresh session.
 */
describe("Schema-backed v5 persistence", () => {
    test("encode produces version: 5 and round-trips through decode", () => {
        const encoded = encodeSession({
            setup: CLASSIC_SETUP_3P,
            hands: [],
            handSizes: [{ player: Player("Anisha"), size: 6 }],
            suggestions: [],
            accusations: [],
        });
        expect(encoded.version).toBe(5);

        const decoded = decodeSession(encoded);
        expect(decoded).toBeDefined();
        expect(decoded?.handSizes).toHaveLength(1);
        expect(String(decoded?.handSizes[0]?.player)).toBe("Anisha");
        expect(decoded?.handSizes[0]?.size).toBe(6);
    });

    test("Schema rejects malformed v5 payloads", () => {
        const malformed = {
            version: 5,
            // `players` should be an array of strings — a number here
            // should fail Schema validation rather than silently decode.
            setup: { players: [42], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
        };
        const result = decodeV5Unknown(malformed);
        expect(Result.isFailure(result)).toBe(true);
    });

    test("Schema rejects v5 payloads with malformed accusations", () => {
        const malformed = {
            version: 5,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            // `accuser` must be a string; a number here should fail.
            accusations: [{ accuser: 42, cards: [] }],
        };
        const result = decodeV5Unknown(malformed);
        expect(Result.isFailure(result)).toBe(true);
    });

    test("Schema requires the accusations field to be present", () => {
        const missingAccusations = {
            version: 5,
            setup: { players: [], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            // intentionally no `accusations` key
        };
        const result = decodeV5Unknown(missingAccusations);
        expect(Result.isFailure(result)).toBe(true);
    });

    test("non-v5 payloads return undefined", () => {
        // A v4-shaped blob no longer has a migration path. It's rejected
        // like any other unrecognized input and the caller falls back to
        // a fresh session.
        const legacyV4 = {
            version: 4,
            setup: { players: ["A"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
        };
        expect(decodeSession(legacyV4)).toBeUndefined();
        expect(decodeSession({ unrelated: true })).toBeUndefined();
        expect(decodeSession(null)).toBeUndefined();
    });
});
