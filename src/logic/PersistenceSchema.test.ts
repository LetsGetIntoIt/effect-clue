import { Result } from "effect";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { decodeSession, encodeSession } from "./Persistence";
import { decodeV4Unknown } from "./PersistenceSchema";
import { Player } from "./GameObjects";

/**
 * The app is pre-production — v4 is the only on-disk format, so
 * there's only one round-trip to cover. Anything that doesn't parse
 * as v4 returns undefined and the caller starts a fresh session.
 */
describe("Schema-backed v4 persistence", () => {
    test("encode produces version: 4 and round-trips through decode", () => {
        const encoded = encodeSession({
            setup: CLASSIC_SETUP_3P,
            hands: [],
            handSizes: [{ player: Player("Anisha"), size: 6 }],
            suggestions: [],
        });
        expect(encoded.version).toBe(4);

        const decoded = decodeSession(encoded);
        expect(decoded).toBeDefined();
        expect(decoded?.handSizes).toHaveLength(1);
        expect(String(decoded?.handSizes[0]?.player)).toBe("Anisha");
        expect(decoded?.handSizes[0]?.size).toBe(6);
    });

    test("Schema rejects malformed v4 payloads", () => {
        const malformed = {
            version: 4,
            // `players` should be an array of strings — a number here
            // should fail Schema validation rather than silently decode.
            setup: { players: [42], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
        };
        const result = decodeV4Unknown(malformed);
        expect(Result.isFailure(result)).toBe(true);
    });

    test("non-v4 payloads return undefined", () => {
        // A v3-shaped blob no longer has a migration path. It's rejected
        // like any other unrecognized input and the caller falls back to
        // a fresh session.
        const legacyV3 = {
            version: 3,
            setup: { players: ["A"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
        };
        expect(decodeSession(legacyV3)).toBeUndefined();
        expect(decodeSession({ unrelated: true })).toBeUndefined();
        expect(decodeSession(null)).toBeUndefined();
    });
});
