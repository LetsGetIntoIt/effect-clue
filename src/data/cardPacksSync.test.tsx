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

    // The dedupe pass at the end of `reconcileCardPacks` exists because
    // localStorage state was observed with multiple entries sharing one
    // server-minted id (e.g. three packs all stamped
    // `q7xao88qw0hobmp43aa5s0r8`, all labelled "Sync test (PENDING)").
    // The server-side schema rules out the matching shape on disk
    // (`card_packs.id` is `PRIMARY KEY`, `(owner_id, client_generated_id)`
    // is `UNIQUE` — verified live), so the corruption is purely local.
    // Phase 1 and Phase 3 both leak dupes from corrupt input; the
    // collapse-to-first-occurrence step at the end is the chokepoint.
    describe("dedupe — defensive against pre-corrupted local state", () => {
        test("collapses local-only siblings sharing one id (Phase 3)", () => {
            const result = reconcileCardPacks(
                [
                    localPack("dup-1", "Office", "Rope"),
                    localPack("dup-1", "Office", "Pipe"),
                    localPack("dup-1", "Office", "Knife"),
                ],
                [],
            );
            expect(result.packs).toHaveLength(1);
            expect(result.packs[0]?.id).toBe("dup-1");
            // First occurrence wins.
            expect(
                cardSetEquals(result.packs[0]!.cardSet, makeCardSet("Rope")),
            ).toBe(true);
        });

        test("collapses Phase-1 siblings that all match one server pack", () => {
            // Two locals with the same id both pair-match the server's
            // `clientGeneratedId`. Without the dedupe, Phase 1 would
            // emit two merged entries with `id: server-1`.
            const result = reconcileCardPacks(
                [
                    localPack("client-1", "Office", "Rope"),
                    localPack("client-1", "Office", "Pipe"),
                ],
                [serverPack("server-1", "client-1", "Office", "Rope")],
            );
            expect(result.packs).toHaveLength(1);
            expect(result.packs[0]?.id).toBe("server-1");
        });

        test(
            "collapses a Phase-1 server-paired entry against a stale " +
                "Phase-3 sibling sharing the post-swap id",
            () => {
                // Real-world shape: localStorage has both the freshly-
                // synced pack (id swapped to `server-1`) AND a stale
                // sibling that still carries `server-1` from a prior
                // sync round. Phase 1 pair-matches `client-1` and emits
                // a server-paired entry first; Phase 3 then tries to
                // pass through the stale sibling. Dedupe drops the
                // sibling so the server-paired entry — the one with
                // `lastSyncedSnapshot` populated — survives.
                const result = reconcileCardPacks(
                    [
                        localPack("client-1", "Office", "Rope"),
                        localPack("server-1", "Office (stale)", "Pipe"),
                    ],
                    [
                        serverPack(
                            "server-1",
                            "client-1",
                            "Office",
                            "Rope",
                        ),
                    ],
                );
                expect(result.packs).toHaveLength(1);
                expect(result.packs[0]?.id).toBe("server-1");
                expect(result.packs[0]?.lastSyncedSnapshot).toBeDefined();
                expect(result.packs[0]?.label).toBe("Office");
            },
        );
    });
});
