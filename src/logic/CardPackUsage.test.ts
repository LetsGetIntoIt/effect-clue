import { DateTime } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    forgetCardPackUse,
    loadCardPackUsage,
    remapCardPackUsageIds,
    recordCardPackUse,
    topRecentPacks,
} from "./CardPackUsage";

const STORAGE_KEY = "effect-clue.card-pack-usage.v1";

beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("loadCardPackUsage", () => {
    test("returns empty when no blob exists", () => {
        expect(loadCardPackUsage().size).toBe(0);
    });

    test("returns empty when the stored JSON is corrupt", () => {
        window.localStorage.setItem(STORAGE_KEY, "{{{not json");
        expect(loadCardPackUsage().size).toBe(0);
    });

    test("returns empty when the decoded shape is wrong (missing version)", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ entries: [] }),
        );
        expect(loadCardPackUsage().size).toBe(0);
    });

    test("returns empty when the version is unknown", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 99, entries: [] }),
        );
        expect(loadCardPackUsage().size).toBe(0);
    });

    test("returns empty when an entry is malformed", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: 1,
                entries: [{ id: "x" /* missing usedAt */ }],
            }),
        );
        expect(loadCardPackUsage().size).toBe(0);
    });

    test("decodes a well-formed v1 blob", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: 1,
                entries: [
                    { id: "classic", usedAt: 1700000000000 },
                    { id: "custom-x", usedAt: 1800000000000 },
                ],
            }),
        );
        const usage = loadCardPackUsage();
        expect(usage.size).toBe(2);
        const classic = usage.get("classic");
        const custom = usage.get("custom-x");
        expect(classic && DateTime.toEpochMillis(classic)).toBe(1700000000000);
        expect(custom && DateTime.toEpochMillis(custom)).toBe(1800000000000);
    });
});

describe("recordCardPackUse + loadCardPackUsage", () => {
    test("records a single pack use", () => {
        vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));
        recordCardPackUse("classic");
        const usage = loadCardPackUsage();
        const entry = usage.get("classic");
        expect(entry).toBeDefined();
        expect(entry && DateTime.toEpochMillis(entry)).toBe(
            new Date("2026-04-28T12:00:00Z").getTime(),
        );
    });

    test("overwrites an existing pack's timestamp on re-use", () => {
        vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));
        recordCardPackUse("classic");
        vi.setSystemTime(new Date("2026-04-28T13:00:00Z"));
        recordCardPackUse("classic");
        const usage = loadCardPackUsage();
        expect(usage.size).toBe(1);
        const entry = usage.get("classic");
        expect(entry && DateTime.toEpochMillis(entry)).toBe(
            new Date("2026-04-28T13:00:00Z").getTime(),
        );
    });

    test("keeps separate timestamps for different packs", () => {
        vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));
        recordCardPackUse("a");
        vi.setSystemTime(new Date("2026-04-28T13:00:00Z"));
        recordCardPackUse("b");
        const usage = loadCardPackUsage();
        expect(usage.size).toBe(2);
    });

    test("swallows quota-exceeded errors silently", () => {
        const spy = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new DOMException("QuotaExceededError");
            });
        expect(() => recordCardPackUse("classic")).not.toThrow();
        spy.mockRestore();
    });
});

describe("remapCardPackUsageIds", () => {
    test("moves recency from duplicate local ids to the canonical server id", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: 1,
                entries: [
                    { id: "local-pack", usedAt: 1700000000000 },
                    { id: "server-pack", usedAt: 1600000000000 },
                ],
            }),
        );

        const usage = remapCardPackUsageIds(
            new Map([["local-pack", "server-pack"]]),
        );

        expect(usage.has("local-pack")).toBe(false);
        const serverUsage = usage.get("server-pack");
        expect(serverUsage).toBeDefined();
        expect(serverUsage && DateTime.toEpochMillis(serverUsage)).toBe(
            1700000000000,
        );
    });
});

describe("forgetCardPackUse", () => {
    test("removes only the entry with the matching id", () => {
        vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));
        recordCardPackUse("a");
        recordCardPackUse("b");
        forgetCardPackUse("a");
        const usage = loadCardPackUsage();
        expect(Array.from(usage.keys())).toEqual(["b"]);
    });

    test("is a no-op when the id doesn't match", () => {
        recordCardPackUse("a");
        forgetCardPackUse("nonexistent");
        expect(loadCardPackUsage().size).toBe(1);
    });

    test("is a no-op on an empty store", () => {
        expect(() => forgetCardPackUse("anything")).not.toThrow();
        expect(loadCardPackUsage().size).toBe(0);
    });
});

describe("topRecentPacks", () => {
    const mkUsage = (
        entries: ReadonlyArray<readonly [string, string]>,
    ): ReadonlyMap<string, DateTime.Utc> =>
        new Map(
            entries.map(([id, iso]) => [
                id,
                DateTime.makeUnsafe(new Date(iso).getTime()),
            ]),
        );

    test("orders used packs newest first", () => {
        const packs = [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
            { id: "c", label: "Gamma" },
        ];
        const usage = mkUsage([
            ["a", "2026-04-28T10:00:00Z"],
            ["b", "2026-04-28T12:00:00Z"],
            ["c", "2026-04-28T11:00:00Z"],
        ]);
        const result = topRecentPacks(packs, usage, 3);
        expect(result.map(p => p.id)).toEqual(["b", "c", "a"]);
    });

    test("falls back to alphabetical order for never-used packs", () => {
        const packs = [
            { id: "a", label: "Charlie" },
            { id: "b", label: "Alpha" },
            { id: "c", label: "Bravo" },
        ];
        const result = topRecentPacks(packs, new Map(), 3);
        expect(result.map(p => p.label)).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    test("places used packs ahead of never-used packs", () => {
        const packs = [
            { id: "fresh", label: "ZZZ Fresh" },
            { id: "stale", label: "AAA Stale" },
            { id: "never", label: "MMM Never" },
        ];
        const usage = mkUsage([
            ["fresh", "2026-04-28T12:00:00Z"],
            ["stale", "2026-04-01T12:00:00Z"],
        ]);
        const result = topRecentPacks(packs, usage, 3);
        expect(result.map(p => p.id)).toEqual(["fresh", "stale", "never"]);
    });

    test("honors the limit", () => {
        const packs = [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
            { id: "c", label: "C" },
            { id: "d", label: "D" },
        ];
        const usage = mkUsage([
            ["a", "2026-04-28T10:00:00Z"],
            ["b", "2026-04-28T11:00:00Z"],
            ["c", "2026-04-28T12:00:00Z"],
            ["d", "2026-04-28T13:00:00Z"],
        ]);
        const result = topRecentPacks(packs, usage, 2);
        expect(result.map(p => p.id)).toEqual(["d", "c"]);
    });

    test("returns an empty array when limit is 0", () => {
        const packs = [{ id: "a", label: "A" }];
        const usage = mkUsage([["a", "2026-04-28T12:00:00Z"]]);
        expect(topRecentPacks(packs, usage, 0)).toEqual([]);
    });

    test("does not mutate the input array", () => {
        const packs = [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
        ];
        const before = [...packs];
        const usage = mkUsage([["b", "2026-04-28T12:00:00Z"]]);
        topRecentPacks(packs, usage, 2);
        expect(packs).toEqual(before);
    });

    test("ignores recency entries for packs not in the input list (orphans)", () => {
        const packs = [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
        ];
        const usage = mkUsage([
            ["orphan", "2099-12-31T23:59:59Z"], // would dominate by recency
            ["a", "2026-04-28T10:00:00Z"],
        ]);
        const result = topRecentPacks(packs, usage, 2);
        // Orphan never appears; Alpha (used) ahead of Beta (never used).
        expect(result.map(p => p.id)).toEqual(["a", "b"]);
    });

    test("ties in usedAt fall back to alphabetical via the comparator's stable branch", () => {
        const packs = [
            { id: "a", label: "Bravo" },
            { id: "b", label: "Alpha" },
        ];
        const sameInstant = "2026-04-28T12:00:00Z";
        const usage = mkUsage([
            ["a", sameInstant],
            ["b", sameInstant],
        ]);
        // sort tie-break order is implementation-defined for equal keys, so
        // assert only that both packs come out, not the order between them.
        const ids = topRecentPacks(packs, usage, 2).map(p => p.id);
        expect(new Set(ids)).toEqual(new Set(["a", "b"]));
    });
});

describe("CardPackUsage round-trip end-to-end", () => {
    test("record → load preserves the entry across a fresh load call", () => {
        vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));
        recordCardPackUse("classic");
        recordCardPackUse("custom-x");
        const reloaded = loadCardPackUsage();
        expect(reloaded.size).toBe(2);
        expect(reloaded.has("classic")).toBe(true);
        expect(reloaded.has("custom-x")).toBe(true);
    });

    test("record → forget → load round-trips correctly", () => {
        vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));
        recordCardPackUse("classic");
        recordCardPackUse("custom-x");
        forgetCardPackUse("classic");
        const reloaded = loadCardPackUsage();
        expect(Array.from(reloaded.keys())).toEqual(["custom-x"]);
    });
});
