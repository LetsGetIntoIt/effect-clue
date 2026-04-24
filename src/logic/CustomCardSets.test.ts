import { beforeEach, describe, expect, test, vi } from "vitest";
import { CardSet, CardEntry, Category } from "./CardSet";
import {
    deleteCustomCardSet,
    loadCustomCardSets,
    saveCustomCardSet,
} from "./CustomCardSets";
import { Card, CardCategory } from "./GameObjects";

const STORAGE_KEY = "effect-clue.custom-presets.v1";

const makePack = (): CardSet =>
    CardSet({
        categories: [
            Category({
                id: CardCategory("cat-w"),
                name: "Weapon",
                cards: [
                    CardEntry({ id: Card("card-knife"), name: "Knife" }),
                    CardEntry({ id: Card("card-rope"), name: "Rope" }),
                ],
            }),
        ],
    });

describe("loadCustomCardSets", () => {
    beforeEach(() => window.localStorage.clear());

    test("returns [] when no blob exists", () => {
        expect(loadCustomCardSets()).toEqual([]);
    });

    test("returns [] when the stored JSON is corrupt", () => {
        window.localStorage.setItem(STORAGE_KEY, "{{{not json");
        expect(loadCustomCardSets()).toEqual([]);
    });

    test("returns [] when the decoded shape is wrong (missing version)", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ presets: [] }),
        );
        expect(loadCustomCardSets()).toEqual([]);
    });

    test("returns [] when the version is unknown", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 99, presets: [] }),
        );
        expect(loadCustomCardSets()).toEqual([]);
    });

    test("returns [] for a v1 blob with malformed presets", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: 1,
                presets: [{ id: "x" /* missing label + categories */ }],
            }),
        );
        expect(loadCustomCardSets()).toEqual([]);
    });
});

describe("saveCustomCardSet + loadCustomCardSets", () => {
    beforeEach(() => window.localStorage.clear());

    test("round-trips a single pack", () => {
        const saved = saveCustomCardSet("My Weapons", makePack());
        const loaded = loadCustomCardSets();
        expect(loaded).toHaveLength(1);
        expect(loaded[0]?.id).toBe(saved.id);
        expect(loaded[0]?.label).toBe("My Weapons");
        expect(loaded[0]?.cardSet.categories[0]?.name).toBe("Weapon");
        expect(loaded[0]?.cardSet.categories[0]?.cards).toHaveLength(2);
    });

    test("appends successive packs without overwriting", () => {
        saveCustomCardSet("One", makePack());
        saveCustomCardSet("Two", makePack());
        const loaded = loadCustomCardSets();
        expect(loaded.map(p => p.label)).toEqual(["One", "Two"]);
    });

    test("returns the newly-persisted pack with a generated id prefixed with `custom-`", () => {
        const pack = saveCustomCardSet("Label", makePack());
        expect(pack.id).toMatch(/^custom-/);
        expect(pack.label).toBe("Label");
    });

    test("generated ids are unique across rapid successive calls", () => {
        const packs = Array.from({ length: 20 }, (_, i) =>
            saveCustomCardSet(`P${i}`, makePack()),
        );
        const ids = new Set(packs.map(p => p.id));
        expect(ids.size).toBe(packs.length);
    });

    test("save swallows quota-exceeded errors silently", () => {
        const spy = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new DOMException("QuotaExceededError");
            });
        expect(() => saveCustomCardSet("Label", makePack())).not.toThrow();
        spy.mockRestore();
    });
});

describe("deleteCustomCardSet", () => {
    beforeEach(() => window.localStorage.clear());

    test("removes only the pack with the matching id", () => {
        const a = saveCustomCardSet("A", makePack());
        const b = saveCustomCardSet("B", makePack());
        deleteCustomCardSet(a.id);
        const remaining = loadCustomCardSets();
        expect(remaining.map(p => p.id)).toEqual([b.id]);
    });

    test("is a no-op when the id doesn't match any pack", () => {
        saveCustomCardSet("A", makePack());
        deleteCustomCardSet("nonexistent");
        expect(loadCustomCardSets()).toHaveLength(1);
    });

    test("on an empty store is a no-op", () => {
        deleteCustomCardSet("anything");
        expect(loadCustomCardSets()).toEqual([]);
    });
});
