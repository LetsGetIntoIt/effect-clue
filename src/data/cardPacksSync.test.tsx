import { describe, expect, test } from "vitest";
import { CardSet } from "../logic/CardSet";
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
});
