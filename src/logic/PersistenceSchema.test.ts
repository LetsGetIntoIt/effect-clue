import { describe, expect, test } from "vitest";
import { Result } from "effect";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { decodeSession, encodeSession } from "./Persistence";
import { decodeV6Unknown } from "./PersistenceSchema";
import { Player } from "./GameObjects";

/**
 * The app is pre-production — v6 is the only on-disk format, so
 * there's only one round-trip to cover. Anything that doesn't parse
 * as v6 returns undefined and the caller starts a fresh session.
 */
describe("Schema-backed v6 persistence", () => {
    test("encode produces version: 6 and round-trips through decode", () => {
        const encoded = encodeSession({
            setup: CLASSIC_SETUP_3P,
            hands: [],
            handSizes: [{ player: Player("Anisha"), size: 6 }],
            suggestions: [],
            accusations: [],
        });
        expect(encoded.version).toBe(6);

        const decoded = decodeSession(encoded);
        expect(decoded).toBeDefined();
        expect(decoded?.handSizes).toHaveLength(1);
        expect(String(decoded?.handSizes[0]?.player)).toBe("Anisha");
        expect(decoded?.handSizes[0]?.size).toBe(6);
    });

    test("Schema rejects malformed v6 payloads", () => {
        const malformed = {
            version: 6,
            // `players` should be an array of strings — a number here
            // should fail Schema validation rather than silently decode.
            setup: { players: [42], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
        };
        const result = decodeV6Unknown(malformed);
        expect(Result.isFailure(result)).toBe(true);
    });

    test("Schema rejects v6 payloads with malformed accusations", () => {
        const malformed = {
            version: 6,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            // `accuser` must be a string; a number here should fail.
            accusations: [{ accuser: 42, cards: [], loggedAt: 0 }],
        };
        const result = decodeV6Unknown(malformed);
        expect(Result.isFailure(result)).toBe(true);
    });

    test("Schema requires the accusations field to be present", () => {
        const missingAccusations = {
            version: 6,
            setup: { players: [], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            // intentionally no `accusations` key
        };
        const result = decodeV6Unknown(missingAccusations);
        expect(Result.isFailure(result)).toBe(true);
    });

    test("Schema requires loggedAt on every suggestion + accusation", () => {
        const missingLoggedAt = {
            version: 6,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            // suggestion lacks loggedAt — must fail.
            suggestions: [
                {
                    suggester: "Anisha",
                    cards: [],
                    nonRefuters: [],
                    refuter: null,
                    seenCard: null,
                },
            ],
            accusations: [],
        };
        const result = decodeV6Unknown(missingLoggedAt);
        expect(Result.isFailure(result)).toBe(true);
    });

    test("non-v6 payloads return undefined", () => {
        // Older session formats no longer have a migration path. They
        // are rejected like any other unrecognized input and the caller
        // falls back to a fresh session.
        const legacyV5 = {
            version: 5,
            setup: { players: ["A"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
        };
        expect(decodeSession(legacyV5)).toBeUndefined();
        expect(decodeSession({ unrelated: true })).toBeUndefined();
        expect(decodeSession(null)).toBeUndefined();
    });
});
