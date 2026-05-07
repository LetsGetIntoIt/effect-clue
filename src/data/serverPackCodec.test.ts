import { describe, expect, test } from "vitest";
import { CardSet } from "../logic/CardSet";
import { Card, CardCategory } from "../logic/GameObjects";
import { CardEntry, Category } from "../logic/GameSetup";
import {
    decodeCardSet,
    decodeServerPack,
    encodeCardSet,
} from "./serverPackCodec";

const sampleCardSet = (): CardSet =>
    CardSet({
        categories: [
            Category({
                id: CardCategory("cat-suspects"),
                name: "Suspects",
                cards: [
                    CardEntry({ id: Card("card-green"), name: "Mr. Green" }),
                    CardEntry({ id: Card("card-plum"), name: "Prof. Plum" }),
                ],
            }),
            Category({
                id: CardCategory("cat-rooms"),
                name: "Rooms",
                cards: [
                    CardEntry({ id: Card("card-kitchen"), name: "Kitchen" }),
                ],
            }),
        ],
    });

describe("serverPackCodec encode/decode round-trip", () => {
    test("decodeCardSet(encodeCardSet(x)) preserves the structure", () => {
        const original = sampleCardSet();
        const encoded = encodeCardSet(original);
        const decoded = decodeCardSet(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded).toEqual(original);
    });

    test("encodeCardSet output is a JSON string with the wire shape", () => {
        const encoded = encodeCardSet(sampleCardSet());
        // The decoder requires `categories[].id`, `.name`, `.cards[].id`,
        // `.cards[].name` — pin those keys explicitly so a future
        // change that drops a field fails this assertion.
        const parsed = JSON.parse(encoded) as {
            categories: ReadonlyArray<{
                id: string;
                name: string;
                cards: ReadonlyArray<{ id: string; name: string }>;
            }>;
        };
        expect(parsed.categories).toHaveLength(2);
        expect(parsed.categories[0]).toEqual({
            id: "cat-suspects",
            name: "Suspects",
            cards: [
                { id: "card-green", name: "Mr. Green" },
                { id: "card-plum", name: "Prof. Plum" },
            ],
        });
    });

    test("decodeServerPack returns a domain CustomCardSet", () => {
        const original = sampleCardSet();
        const decoded = decodeServerPack({
            id: "server-id",
            clientGeneratedId: "local-id",
            label: "Classic",
            cardSetData: encodeCardSet(original),
        });
        expect(decoded).not.toBeNull();
        expect(decoded?.id).toBe("server-id");
        expect(decoded?.label).toBe("Classic");
        expect(decoded?.cardSet).toEqual(original);
    });

    test("decodeCardSet returns null on a malformed payload", () => {
        expect(decodeCardSet("not json")).toBeNull();
        expect(decodeCardSet("{}")).toBeNull();
        expect(
            decodeCardSet(JSON.stringify({ categories: "wrong shape" })),
        ).toBeNull();
    });
});
