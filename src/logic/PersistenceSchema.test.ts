import { Result } from "effect";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { decodeSession, encodeSession } from "./Persistence";
import { decodeV4Unknown } from "./PersistenceSchema";
import { Player } from "./GameObjects";

/**
 * Smoke tests for the v4 Schema-backed persistence path introduced in
 * Phase 3.5. The existing v1/v2/v3 migration coverage lives in
 * StableIdsIntegration.test.ts; here we prove that
 *
 *  (a) fresh writes go to v4 and round-trip losslessly,
 *  (b) Schema rejects malformed v4 payloads (instead of silently
 *      returning undefined the way the hand-rolled decoder did), and
 *  (c) the decodeSession entry point still decodes legacy v3 payloads
 *      unchanged — we haven't regressed the migration chain.
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

    test("legacy v3 payloads still decode unchanged", () => {
        const legacy = {
            version: 3,
            setup: {
                players: ["Anisha"],
                categories: [
                    {
                        id: "cat-a",
                        name: "Suspects",
                        cards: [{ id: "c1", name: "Miss Scarlet" }],
                    },
                ],
            },
            hands: [],
            handSizes: [],
            suggestions: [],
        };
        const decoded = decodeSession(legacy);
        expect(decoded).toBeDefined();
        expect(decoded?.setup.players.map(String)).toEqual(["Anisha"]);
    });
});
