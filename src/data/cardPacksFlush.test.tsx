import {
    afterEach,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from "vitest";
import { DateTime } from "effect";
import { CardSet } from "../logic/CardSet";
import { Card, CardCategory } from "../logic/GameObjects";
import { CardEntry, Category } from "../logic/GameSetup";
import {
    addTombstone,
    loadTombstones,
} from "../logic/CardPackTombstones";
import {
    loadCustomCardSets,
    replaceCustomCardSets,
    type CustomCardSet,
} from "../logic/CustomCardSets";

// Mocks must be declared before imports of the module under test —
// `vi.mock` is hoisted by Vitest.
const saveCardPackMock = vi.fn();
const deleteCardPackMock = vi.fn();

vi.mock("../server/actions/packs", () => ({
    saveCardPack: (...args: unknown[]) => saveCardPackMock(...args),
    deleteCardPack: (...args: unknown[]) => deleteCardPackMock(...args),
    // Other exports left as stubs — flush only uses these two.
    getMyCardPacks: vi.fn(),
    pushLocalPacksOnSignIn: vi.fn(),
}));

import { flushPendingChanges } from "./cardPacksSync";

const makeCardSet = (cardName: string): CardSet =>
    CardSet({
        categories: [
            Category({
                id: CardCategory(`category-${cardName}`),
                name: "Suspect",
                cards: [
                    CardEntry({
                        id: Card(`card-${cardName}`),
                        name: cardName,
                    }),
                ],
            }),
        ],
    });

const localPack = (
    id: string,
    label: string,
    cardName: string,
    overrides: Partial<CustomCardSet> = {},
): CustomCardSet => ({
    id,
    label,
    cardSet: makeCardSet(cardName),
    ...overrides,
});

const persistedServerRow = (
    id: string,
    clientGeneratedId: string,
    label: string,
    cardName: string,
) => ({
    id,
    clientGeneratedId,
    label,
    cardSetData: JSON.stringify(makeCardSet(cardName)),
});

const setOnline = (online: boolean) => {
    Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => online,
    });
};

describe("flushPendingChanges", () => {
    beforeEach(() => {
        window.localStorage.clear();
        saveCardPackMock.mockReset();
        deleteCardPackMock.mockReset();
        setOnline(true);
    });
    afterEach(() => {
        window.localStorage.clear();
    });

    test("returns ok when nothing is pending", async () => {
        replaceCustomCardSets([
            {
                ...localPack("server-1", "Office", "Rope"),
                lastSyncedSnapshot: {
                    label: "Office",
                    cardSet: makeCardSet("Rope"),
                },
            },
        ]);
        const result = await flushPendingChanges();
        expect(result.ok).toBe(true);
    });

    test("offline + unsynced → returns offline summary without calling network", async () => {
        setOnline(false);
        replaceCustomCardSets([
            {
                ...localPack("custom-1", "Office", "Rope"),
                unsyncedSince: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
            },
        ]);
        const result = await flushPendingChanges();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe("offline");
            expect(result.unsynced.created).toEqual([
                { id: "custom-1", label: "Office" },
            ]);
        }
        expect(saveCardPackMock).not.toHaveBeenCalled();
    });

    test("offline + tombstone → reports as deleted", async () => {
        setOnline(false);
        addTombstone({
            id: "server-1",
            label: "Mansion",
            deletedAt: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
        });
        const result = await flushPendingChanges();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe("offline");
            expect(result.unsynced.deleted).toEqual([
                { id: "server-1", label: "Mansion" },
            ]);
        }
    });

    test("online + push succeeds → ok and localStorage marked synced", async () => {
        replaceCustomCardSets([
            {
                ...localPack("custom-1", "Office", "Rope"),
                unsyncedSince: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
            },
        ]);
        saveCardPackMock.mockResolvedValueOnce(
            persistedServerRow("server-1", "custom-1", "Office", "Rope"),
        );
        const result = await flushPendingChanges();
        expect(result.ok).toBe(true);
        expect(saveCardPackMock).toHaveBeenCalledTimes(1);
        // Pins the regression class: `cardSetData` must be a JSON
        // string at the server-action boundary, not a `CardSet`
        // class instance (those don't survive Next.js RSC
        // serialisation).
        expect(saveCardPackMock).toHaveBeenCalledWith(
            expect.objectContaining({
                cardSetData: expect.any(String),
            }),
        );
        const persisted = loadCustomCardSets();
        expect(persisted[0]?.id).toBe("server-1");
        expect(persisted[0]?.unsyncedSince).toBeUndefined();
        expect(persisted[0]?.lastSyncedSnapshot?.label).toBe("Office");
    });

    test("online + push fails → returns serverError summary", async () => {
        replaceCustomCardSets([
            {
                ...localPack("custom-1", "Office", "Rope"),
                unsyncedSince: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
            },
        ]);
        saveCardPackMock.mockRejectedValueOnce(new Error("boom"));
        const result = await flushPendingChanges();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe("serverError");
            expect(result.unsynced.created).toEqual([
                { id: "custom-1", label: "Office" },
            ]);
        }
    });

    test("online + tombstone delete succeeds → tombstone cleared", async () => {
        addTombstone({
            id: "server-1",
            label: "Mansion",
            deletedAt: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
        });
        deleteCardPackMock.mockResolvedValueOnce(undefined);
        const result = await flushPendingChanges();
        expect(result.ok).toBe(true);
        expect(deleteCardPackMock).toHaveBeenCalledTimes(1);
        expect(loadTombstones()).toEqual([]);
    });

    test("online + tombstone delete fails → reported in deleted summary", async () => {
        addTombstone({
            id: "server-1",
            label: "Mansion",
            deletedAt: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
        });
        deleteCardPackMock.mockRejectedValueOnce(new Error("offline"));
        const result = await flushPendingChanges();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.unsynced.deleted).toEqual([
                { id: "server-1", label: "Mansion" },
            ]);
        }
    });

    test("modified pack with diff against snapshot → reported with tags", async () => {
        replaceCustomCardSets([
            {
                ...localPack("server-1", "Office Updated", "Pipe"),
                unsyncedSince: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
                lastSyncedSnapshot: {
                    label: "Office",
                    cardSet: makeCardSet("Rope"),
                },
            },
        ]);
        // Server save fails so the pack stays modified.
        saveCardPackMock.mockRejectedValueOnce(new Error("offline"));
        const result = await flushPendingChanges();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.unsynced.modified).toHaveLength(1);
            expect(result.unsynced.modified[0]).toMatchObject({
                id: "server-1",
                label: "Office Updated",
                labelChanged: true,
                cardsChanged: true,
            });
        }
    });

    test("anon-era pack with no metadata → flush pushes and clears", async () => {
        // Mimics the post-sign-in case where push succeeded server-side
        // but reconcile hasn't run yet, OR where push failed entirely.
        replaceCustomCardSets([localPack("custom-1", "Office", "Rope")]);
        saveCardPackMock.mockResolvedValueOnce(
            persistedServerRow("server-1", "custom-1", "Office", "Rope"),
        );
        const result = await flushPendingChanges();
        expect(result.ok).toBe(true);
        expect(saveCardPackMock).toHaveBeenCalledTimes(1);
    });

    test("modified pack pushed with same content as snapshot → ok", async () => {
        replaceCustomCardSets([
            {
                ...localPack("server-1", "Office", "Rope"),
                unsyncedSince: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
                lastSyncedSnapshot: {
                    label: "Office",
                    cardSet: makeCardSet("Rope"),
                },
            },
        ]);
        saveCardPackMock.mockResolvedValueOnce(
            persistedServerRow("server-1", "server-1", "Office", "Rope"),
        );
        const result = await flushPendingChanges();
        expect(result.ok).toBe(true);
    });
});
