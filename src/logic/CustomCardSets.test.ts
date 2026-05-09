import { beforeEach, describe, expect, test, vi } from "vitest";
import { DateTime } from "effect";
import { CardSet, CardEntry, Category } from "./CardSet";
import {
    addTombstone,
    loadTombstones,
} from "./CardPackTombstones";
import {
    clearAccountTiedLocalState,
    deleteCustomCardSet,
    loadCustomCardSets,
    markPackSynced,
    markPackUnsynced,
    replaceCustomCardSets,
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

    // Read-side dedupe — see `dedupePacksById` in `CustomCardSets.ts`
    // for the full backstory. The matching read of corrupt on-disk
    // state must not produce duplicates, since `useCustomCardPacks`
    // seeds React Query's `initialData` with `loadCustomCardSets()`
    // and any duplicates would reach `<SetupStepCardPack>` on first
    // render, before reconcile / writeAll can clean up.
    test("dedupes by id when the on-disk blob has duplicate ids", () => {
        const baseCategory = {
            id: "cat-w",
            name: "Weapon",
            cards: [{ id: "card-knife", name: "Knife" }],
        };
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: 1,
                presets: [
                    {
                        id: "q7xao88qw0hobmp43aa5s0r8",
                        label: "Sync test (PENDING)",
                        categories: [baseCategory],
                    },
                    {
                        id: "q7xao88qw0hobmp43aa5s0r8",
                        label: "Sync test (PENDING)",
                        categories: [baseCategory],
                    },
                    {
                        id: "q7xao88qw0hobmp43aa5s0r8",
                        label: "Sync test (PENDING)",
                        categories: [baseCategory],
                    },
                ],
            }),
        );
        const loaded = loadCustomCardSets();
        expect(loaded).toHaveLength(1);
        expect(loaded[0]?.id).toBe("q7xao88qw0hobmp43aa5s0r8");
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

    test("with an existingId, updates the pack in place and preserves id", () => {
        const original = saveCustomCardSet("First", makePack());
        // Simulate the "loaded but edited" flow: snapshot a different
        // CardSet but pass the original's id back in.
        const editedPack = makePack();
        const updated = saveCustomCardSet(
            "First — edited",
            editedPack,
            original.id,
        );
        expect(updated.id).toBe(original.id);
        expect(updated.label).toBe("First — edited");
        const all = loadCustomCardSets();
        // No new pack was inserted — same length, same id, new label.
        expect(all).toHaveLength(1);
        expect(all[0]!.id).toBe(original.id);
        expect(all[0]!.label).toBe("First — edited");
    });

    test("with a stale existingId, falls back to insert", () => {
        const before = saveCustomCardSet("Real", makePack());
        const ghost = saveCustomCardSet(
            "Ghost",
            makePack(),
            "custom-not-in-storage",
        );
        // The ghost id was not present, so a new pack was inserted
        // with a freshly-minted id (NOT the stale id we passed in).
        expect(ghost.id).not.toBe("custom-not-in-storage");
        expect(ghost.id).not.toBe(before.id);
        const all = loadCustomCardSets();
        expect(all.map(p => p.id).sort()).toEqual(
            [before.id, ghost.id].sort(),
        );
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

describe("markPackUnsynced", () => {
    beforeEach(() => window.localStorage.clear());

    test("stamps unsyncedSince on a pack that exists", () => {
        const saved = saveCustomCardSet("A", makePack());
        markPackUnsynced(saved.id);
        const loaded = loadCustomCardSets();
        expect(loaded[0]?.unsyncedSince).toBeDefined();
    });

    test("is a no-op when the id doesn't match", () => {
        saveCustomCardSet("A", makePack());
        markPackUnsynced("nonexistent");
        const loaded = loadCustomCardSets();
        expect(loaded[0]?.unsyncedSince).toBeUndefined();
    });

    test("does NOT mutate other packs", () => {
        const a = saveCustomCardSet("A", makePack());
        const b = saveCustomCardSet("B", makePack());
        markPackUnsynced(a.id);
        const loaded = loadCustomCardSets();
        expect(loaded.find(p => p.id === a.id)?.unsyncedSince).toBeDefined();
        expect(loaded.find(p => p.id === b.id)?.unsyncedSince).toBeUndefined();
    });
});

describe("markPackSynced", () => {
    beforeEach(() => window.localStorage.clear());

    test("swaps id, sets snapshot, clears unsyncedSince", () => {
        const saved = saveCustomCardSet("Office", makePack());
        markPackUnsynced(saved.id);
        const result = markPackSynced(saved.id, {
            id: "server-1",
            label: "Office",
            cardSet: makePack(),
        });
        expect(result?.id).toBe("server-1");
        expect(result?.unsyncedSince).toBeUndefined();
        expect(result?.lastSyncedSnapshot?.label).toBe("Office");
        const loaded = loadCustomCardSets();
        expect(loaded[0]?.id).toBe("server-1");
    });

    test("returns undefined when the local id doesn't match", () => {
        saveCustomCardSet("A", makePack());
        const result = markPackSynced("nonexistent", {
            id: "server-1",
            label: "A",
            cardSet: makePack(),
        });
        expect(result).toBeUndefined();
    });

    test("preserves the local label / cardSet (server snapshot is separate)", () => {
        const saved = saveCustomCardSet("My Office", makePack());
        const result = markPackSynced(saved.id, {
            id: "server-1",
            label: "Server Office",
            cardSet: makePack(),
        });
        expect(result?.label).toBe("My Office");
        expect(result?.lastSyncedSnapshot?.label).toBe("Server Office");
    });
});

describe("replaceCustomCardSets metadata round-trip", () => {
    beforeEach(() => window.localStorage.clear());

    test("preserves unsyncedSince and lastSyncedSnapshot", () => {
        replaceCustomCardSets([
            {
                id: "server-1",
                label: "Office",
                cardSet: makePack(),
                unsyncedSince: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
                lastSyncedSnapshot: {
                    label: "Office",
                    cardSet: makePack(),
                },
            },
        ]);
        const loaded = loadCustomCardSets();
        expect(loaded).toHaveLength(1);
        expect(DateTime.toEpochMillis(loaded[0]!.unsyncedSince!)).toBe(
            DateTime.toEpochMillis(
                DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
            ),
        );
        expect(loaded[0]?.lastSyncedSnapshot?.label).toBe("Office");
    });
});

// Belt-and-suspenders for the same dedupe invariant
// `reconcileCardPacks` enforces in memory: localStorage state has
// been observed with multiple entries sharing one server-minted id
// (e.g. three rows all stamped `q7xao88qw0hobmp43aa5s0r8`,
// "Sync test (PENDING)"), which the server-side schema rules out
// (`card_packs.id` PK + `(owner_id, client_generated_id)` UNIQUE,
// verified live). Provenance unclear; symptom is React's "Encountered
// two children with the same key" warning in `<SetupStepCardPack>`'s
// pill row + a silently-dropped pack. Cleaning up at the localStorage
// write boundary means any path that flushes packs (reconcile,
// markPackSynced, replaceCustomCardSets) self-heals the on-disk blob.
describe("writeAll dedupe — collapses ids on persist", () => {
    beforeEach(() => window.localStorage.clear());

    test(
        "replaceCustomCardSets keeps the first occurrence when ids collide",
        () => {
            replaceCustomCardSets([
                {
                    id: "server-1",
                    label: "Office",
                    cardSet: makePack(),
                },
                {
                    id: "server-1",
                    label: "Office (stale)",
                    cardSet: makePack(),
                },
                {
                    id: "server-1",
                    label: "Office (stale 2)",
                    cardSet: makePack(),
                },
            ]);
            const loaded = loadCustomCardSets();
            expect(loaded).toHaveLength(1);
            expect(loaded[0]?.label).toBe("Office");
        },
    );

    test("non-colliding ids round-trip unchanged", () => {
        replaceCustomCardSets([
            { id: "a", label: "A", cardSet: makePack() },
            { id: "b", label: "B", cardSet: makePack() },
            { id: "c", label: "C", cardSet: makePack() },
        ]);
        const loaded = loadCustomCardSets();
        expect(loaded.map(p => p.id)).toEqual(["a", "b", "c"]);
    });
});

describe("clearAccountTiedLocalState", () => {
    beforeEach(() => window.localStorage.clear());

    test("clears card-pack, tombstones, and usage keys", () => {
        saveCustomCardSet("Office", makePack());
        addTombstone({
            id: "server-1",
            label: "Mansion",
            deletedAt: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
        });
        window.localStorage.setItem(
            "effect-clue.card-pack-usage.v1",
            JSON.stringify({ version: 1, entries: [] }),
        );
        clearAccountTiedLocalState();
        expect(loadCustomCardSets()).toEqual([]);
        expect(loadTombstones()).toEqual([]);
        expect(
            window.localStorage.getItem("effect-clue.card-pack-usage.v1"),
        ).toBeNull();
    });

    test("does NOT clear non-account-tied keys", () => {
        // Game state, splash, tour, install — all kept.
        const survivors = [
            "effect-clue.session.v7",
            "effect-clue.splash.v1",
            "effect-clue.tour.setup.v1",
            "effect-clue.install-prompt.v1",
        ];
        for (const key of survivors) {
            window.localStorage.setItem(key, "x");
        }
        saveCustomCardSet("Office", makePack());
        clearAccountTiedLocalState();
        for (const key of survivors) {
            expect(window.localStorage.getItem(key)).toBe("x");
        }
    });
});
