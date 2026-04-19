import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Result } from "effect";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { decodeSession, encodeSession } from "./Persistence";
import { decodeV4Unknown } from "./PersistenceSchema";
import { Player } from "./GameObjects";

const FIXTURES_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    "__fixtures__",
);
const loadFixture = (name: string): unknown =>
    JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));

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

/**
 * Frozen fixtures for the legacy on-disk shapes. These lock the
 * migration chain's behaviour before commits 7-9 rewrite the chain
 * with Schema.transform — whatever the new transforms do has to
 * produce the same GameSession shape from these exact payloads.
 *
 * The fixtures live in __fixtures__/session-v{1,2,3}.json so they
 * double as canonical examples of each schema era.
 */
describe("legacy fixtures decode through the migration chain", () => {
    test("v1 fixture migrates through v2 -> v3 -> session", () => {
        const decoded = decodeSession(loadFixture("session-v1.json"));
        expect(decoded).toBeDefined();
        expect(decoded!.setup.players.map(String)).toEqual([
            "Anisha",
            "Bob",
            "Cho",
        ]);
        expect(decoded!.setup.categories.map(c => c.name)).toEqual([
            "Suspects",
            "Weapons",
            "Rooms",
        ]);
        expect(decoded!.setup.categories[0]?.cards.map(c => c.name)).toEqual([
            "Miss Scarlet",
            "Col. Mustard",
        ]);
        expect(decoded!.hands).toHaveLength(1);
        expect(String(decoded!.hands[0]!.player)).toBe("Anisha");
    });

    test("v2 fixture migrates through v3 -> session", () => {
        const decoded = decodeSession(loadFixture("session-v2.json"));
        expect(decoded).toBeDefined();
        // migrateV2ToV3 derives ids from names, so the Miss Scarlet
        // card entry should come back with id = "Miss Scarlet".
        const suspects = decoded!.setup.categories[0]!;
        expect(suspects.name).toBe("Suspects");
        expect(String(suspects.cards[0]!.id)).toBe("Miss Scarlet");
        expect(decoded!.suggestions).toHaveLength(1);
        expect(String(decoded!.suggestions[0]!.suggester)).toBe("Anisha");
        expect(String(decoded!.suggestions[0]!.refuter)).toBe("Bob");
    });

    test("v3 fixture decodes without migration", () => {
        const decoded = decodeSession(loadFixture("session-v3.json"));
        expect(decoded).toBeDefined();
        expect(decoded!.setup.categories).toHaveLength(3);
        expect(decoded!.suggestions).toHaveLength(1);
        const s = decoded!.suggestions[0]!;
        expect(String(s.seenCard)).toBe("Knife");
    });
});
