import { describe, expect, test } from "vitest";
import { DateTime } from "effect";
import { cardSetEquals, CardSet } from "../logic/CardSet";
import { Card, CardCategory } from "../logic/GameObjects";
import { CardEntry, Category } from "../logic/GameSetup";
import type { CustomCardSet } from "../logic/CustomCardSets";
import type { PersistedCardPack } from "../server/actions/packs";
import { reconcileCardPacks } from "./cardPacksSync";

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
): CustomCardSet => ({
    id,
    label,
    cardSet: makeCardSet(cardName),
});

const serverPack = (
    id: string,
    clientGeneratedId: string,
    label: string,
    cardName: string,
): PersistedCardPack => ({
    id,
    clientGeneratedId,
    label,
    cardSetData: JSON.stringify(makeCardSet(cardName)),
});

describe("reconcileCardPacks", () => {
    test("exact duplicate keeps the server canonical pack", () => {
        const result = reconcileCardPacks(
            [localPack("local-1", "Office", "Rope")],
            [serverPack("server-1", "other-client", "Office", "Rope")],
        );

        expect(result.packs.map((pack) => pack.id)).toEqual(["server-1"]);
        expect(result.idMap.get("local-1")).toBe("server-1");
        expect(result.countPulled).toBe(0);
    });

    test("same label with different contents keeps both packs", () => {
        const result = reconcileCardPacks(
            [localPack("local-1", "Office", "Rope")],
            [serverPack("server-1", "other-client", "Office", "Pipe")],
        );

        expect(result.packs.map((pack) => pack.id)).toEqual([
            "server-1",
            "local-1",
        ]);
        expect(result.idMap.size).toBe(0);
    });

    test("same contents with a different label keeps both packs", () => {
        const result = reconcileCardPacks(
            [localPack("local-1", "Office", "Rope")],
            [serverPack("server-1", "other-client", "Mansion", "Rope")],
        );

        expect(result.packs.map((pack) => pack.id)).toEqual([
            "server-1",
            "local-1",
        ]);
        expect(result.idMap.size).toBe(0);
    });

    test("server-only packs are pulled into the local library", () => {
        const result = reconcileCardPacks(
            [],
            [serverPack("server-1", "other-client", "Office", "Rope")],
        );

        expect(result.packs.map((pack) => pack.id)).toEqual(["server-1"]);
        expect(result.countPulled).toBe(1);
    });

    test("same client id keeps the server label after rename-on-push", () => {
        const result = reconcileCardPacks(
            [localPack("local-1", "Office", "Rope")],
            [serverPack("server-1", "local-1", "Office (2)", "Rope")],
        );

        expect(result.packs).toMatchObject([
            { id: "server-1", label: "Office (2)" },
        ]);
        expect(result.idMap.get("local-1")).toBe("server-1");
    });

    test("server-only packs land with lastSyncedSnapshot populated", () => {
        const result = reconcileCardPacks(
            [],
            [serverPack("server-1", "other-client", "Office", "Rope")],
        );
        expect(result.packs[0]?.lastSyncedSnapshot).toBeDefined();
        expect(result.packs[0]?.lastSyncedSnapshot?.label).toBe("Office");
        expect(
            cardSetEquals(
                result.packs[0]!.lastSyncedSnapshot!.cardSet,
                makeCardSet("Rope"),
            ),
        ).toBe(true);
        expect(result.packs[0]?.unsyncedSince).toBeUndefined();
    });

    test("paired-and-matching content clears unsyncedSince and sets snapshot", () => {
        const local: CustomCardSet = {
            ...localPack("local-1", "Office", "Rope"),
            unsyncedSince: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
        };
        const result = reconcileCardPacks(
            [local],
            [serverPack("server-1", "local-1", "Office", "Rope")],
        );
        expect(result.packs[0]?.id).toBe("server-1");
        expect(result.packs[0]?.unsyncedSince).toBeUndefined();
        expect(result.packs[0]?.lastSyncedSnapshot?.label).toBe("Office");
    });

    test("conflict with unsyncedSince — local wins on label/cardSet", () => {
        const local: CustomCardSet = {
            ...localPack("local-1", "Office Updated", "Rope"),
            unsyncedSince: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
            lastSyncedSnapshot: {
                label: "Office",
                cardSet: makeCardSet("Rope"),
            },
        };
        const result = reconcileCardPacks(
            [local],
            // Server has a newer "Mansion" version (other device)
            [serverPack("server-1", "local-1", "Mansion", "Pipe")],
        );
        expect(result.packs[0]?.id).toBe("server-1");
        expect(result.packs[0]?.label).toBe("Office Updated");
        expect(
            cardSetEquals(
                result.packs[0]!.cardSet,
                makeCardSet("Rope"),
            ),
        ).toBe(true);
        // unsyncedSince retained — user still has unflushed local edits.
        expect(result.packs[0]?.unsyncedSince).toBeDefined();
        // Baseline refreshed to the new server view.
        expect(result.packs[0]?.lastSyncedSnapshot?.label).toBe("Mansion");
    });

    test("conflict without unsyncedSince — server wins (rename / other device)", () => {
        const local = localPack("local-1", "Office", "Rope");
        const result = reconcileCardPacks(
            [local],
            [serverPack("server-1", "local-1", "Office (renamed)", "Rope")],
        );
        expect(result.packs[0]?.label).toBe("Office (renamed)");
        expect(result.packs[0]?.unsyncedSince).toBeUndefined();
        expect(result.packs[0]?.lastSyncedSnapshot?.label).toBe(
            "Office (renamed)",
        );
    });

    test("tombstone filter drops server packs by id and clientGeneratedId", () => {
        const result = reconcileCardPacks(
            [],
            [
                serverPack("server-1", "other-client", "Office", "Rope"),
                serverPack("server-2", "local-1", "Mansion", "Pipe"),
            ],
            new Set(["server-1", "local-1"]),
        );
        expect(result.packs).toEqual([]);
    });

    test("tombstone filter drops local packs by id", () => {
        const result = reconcileCardPacks(
            [localPack("local-1", "Office", "Rope")],
            [],
            new Set(["local-1"]),
        );
        expect(result.packs).toEqual([]);
    });

    test("local-only pack preserves its sync metadata across reconcile", () => {
        const local: CustomCardSet = {
            ...localPack("local-1", "Office", "Rope"),
            unsyncedSince: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
        };
        const result = reconcileCardPacks([local], []);
        expect(result.packs[0]?.unsyncedSince).toBeDefined();
        expect(result.packs[0]?.id).toBe("local-1");
    });
});
