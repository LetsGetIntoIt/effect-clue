import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DateTime } from "effect";
import {
    addTombstone,
    clearAllTombstones,
    clearTombstones,
    loadTombstones,
} from "./CardPackTombstones";

const at = (iso: string): DateTime.Utc => DateTime.makeUnsafe(iso);

const STORAGE_KEY = "effect-clue.deleted-packs.v1";

describe("CardPackTombstones", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });
    afterEach(() => {
        window.localStorage.clear();
    });

    test("loadTombstones returns empty when key absent", () => {
        expect(loadTombstones()).toEqual([]);
    });

    test("addTombstone persists and loadTombstones reads it back", () => {
        addTombstone({
            id: "pack-1",
            label: "Office",
            deletedAt: at("2026-04-22T12:00:00Z"),
        });
        const loaded = loadTombstones();
        expect(loaded).toHaveLength(1);
        expect(loaded[0]?.id).toBe("pack-1");
        expect(loaded[0]?.label).toBe("Office");
        expect(DateTime.toEpochMillis(loaded[0]!.deletedAt)).toBe(
            DateTime.toEpochMillis(at("2026-04-22T12:00:00Z")),
        );
    });

    test("addTombstone with duplicate id replaces rather than appends", () => {
        addTombstone({
            id: "pack-1",
            label: "Office",
            deletedAt: at("2026-04-22T12:00:00Z"),
        });
        addTombstone({
            id: "pack-1",
            label: "Office (renamed)",
            deletedAt: at("2026-04-22T13:00:00Z"),
        });
        const loaded = loadTombstones();
        expect(loaded).toHaveLength(1);
        expect(loaded[0]?.label).toBe("Office (renamed)");
    });

    test("clearTombstones removes only the given ids", () => {
        addTombstone({
            id: "pack-1",
            label: "Office",
            deletedAt: at("2026-04-22T12:00:00Z"),
        });
        addTombstone({
            id: "pack-2",
            label: "Mansion",
            deletedAt: at("2026-04-22T12:01:00Z"),
        });
        addTombstone({
            id: "pack-3",
            label: "Library",
            deletedAt: at("2026-04-22T12:02:00Z"),
        });
        clearTombstones(["pack-2"]);
        const loaded = loadTombstones();
        expect(loaded.map(t => t.id)).toEqual(["pack-1", "pack-3"]);
    });

    test("clearTombstones with empty list is a no-op", () => {
        addTombstone({
            id: "pack-1",
            label: "Office",
            deletedAt: at("2026-04-22T12:00:00Z"),
        });
        clearTombstones([]);
        expect(loadTombstones()).toHaveLength(1);
    });

    test("clearTombstones with non-matching ids leaves storage untouched", () => {
        addTombstone({
            id: "pack-1",
            label: "Office",
            deletedAt: at("2026-04-22T12:00:00Z"),
        });
        const before = window.localStorage.getItem(STORAGE_KEY);
        clearTombstones(["pack-99"]);
        const after = window.localStorage.getItem(STORAGE_KEY);
        expect(after).toBe(before);
    });

    test("clearAllTombstones drops the storage key entirely", () => {
        addTombstone({
            id: "pack-1",
            label: "Office",
            deletedAt: at("2026-04-22T12:00:00Z"),
        });
        clearAllTombstones();
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(loadTombstones()).toEqual([]);
    });

    test("loadTombstones tolerates a malformed payload by returning empty", () => {
        window.localStorage.setItem(STORAGE_KEY, "not-json");
        expect(loadTombstones()).toEqual([]);
    });

    test("loadTombstones rejects a wrong-shape payload (Schema fails)", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 999, entries: [] }),
        );
        expect(loadTombstones()).toEqual([]);
    });
});
