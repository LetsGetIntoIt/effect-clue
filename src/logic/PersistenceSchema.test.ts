import { describe, expect, test } from "vitest";
import { Result } from "effect";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { decodeSession, encodeSession } from "./Persistence";
import {
    decodePersistedSessionUnknown,
    decodeV6Unknown,
} from "./PersistenceSchema";
import { Player } from "./GameObjects";

/**
 * The app writes v7 but still accepts v6 so existing local games
 * survive the hypothesis-storage upgrade.
 */
describe("Schema-backed v6 persistence", () => {
    test("encode produces version: 7 and round-trips through decode", () => {
        const encoded = encodeSession({
            setup: CLASSIC_SETUP_3P,
            hands: [],
            handSizes: [{ player: Player("Anisha"), size: 6 }],
            suggestions: [],
            accusations: [],
        });
        expect(encoded.version).toBe(7);

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
        // Older pre-v6 session formats have no migration path. They
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

    test("union decoder still accepts v6 payloads", () => {
        const legacyV6 = {
            version: 6,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
        };
        expect(Result.isSuccess(decodePersistedSessionUnknown(legacyV6)))
            .toBe(true);
        expect(Result.isSuccess(decodeV6Unknown(legacyV6))).toBe(true);
    });
});
