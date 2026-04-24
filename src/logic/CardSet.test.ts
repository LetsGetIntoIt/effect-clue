import { describe, expect, test } from "vitest";
import { Equal } from "effect";
import {
    allCardEntries,
    allCardIds,
    CardEntry,
    CardSet,
    Category,
    cardIdsInCategory,
    cardName,
    caseFileSize,
    categoryName,
    categoryOfCard,
    findCardEntry,
    findCategoryEntry,
} from "./CardSet";
import { Card, CardCategory } from "./GameObjects";

const weaponId = CardCategory("cat-weapon");
const roomId = CardCategory("cat-room");
const knifeId = Card("card-knife");
const ropeId = Card("card-rope");
const kitchenId = Card("card-kitchen");
const hallId = Card("card-hall");

const weaponCat = Category({
    id: weaponId,
    name: "Weapon",
    cards: [
        CardEntry({ id: knifeId, name: "Knife" }),
        CardEntry({ id: ropeId, name: "Rope" }),
    ],
});
const roomCat = Category({
    id: roomId,
    name: "Room",
    cards: [
        CardEntry({ id: kitchenId, name: "Kitchen" }),
        CardEntry({ id: hallId, name: "Hall" }),
    ],
});
const set = CardSet({ categories: [weaponCat, roomCat] });

describe("CardEntry / Category constructors", () => {
    test("CardEntry preserves id and name", () => {
        const e = CardEntry({ id: knifeId, name: "Knife" });
        expect(e.id).toBe(knifeId);
        expect(e.name).toBe("Knife");
    });

    test("two CardEntries with equal fields are Equal.equals", () => {
        const a = CardEntry({ id: knifeId, name: "Knife" });
        const b = CardEntry({ id: knifeId, name: "Knife" });
        expect(Equal.equals(a, b)).toBe(true);
    });

    test("Category preserves id, name, and card array", () => {
        const c = Category({
            id: weaponId,
            name: "Weapon",
            cards: [CardEntry({ id: knifeId, name: "Knife" })],
        });
        expect(c.id).toBe(weaponId);
        expect(c.name).toBe("Weapon");
        expect(c.cards).toHaveLength(1);
    });

    test("CardSet preserves category order", () => {
        expect(set.categories.map(c => c.id)).toEqual([weaponId, roomId]);
    });
});

describe("findCategoryEntry", () => {
    test("returns the category with a matching id", () => {
        expect(findCategoryEntry(set, weaponId)).toBe(weaponCat);
    });

    test("returns undefined for an unknown category id", () => {
        expect(findCategoryEntry(set, CardCategory("cat-missing")))
            .toBeUndefined();
    });
});

describe("findCardEntry", () => {
    test("returns the entry with a matching card id", () => {
        const hit = findCardEntry(set, kitchenId);
        expect(hit).toBeDefined();
        expect(hit?.name).toBe("Kitchen");
    });

    test("crosses categories to find a card", () => {
        expect(findCardEntry(set, hallId)?.name).toBe("Hall");
    });

    test("returns undefined for an unknown card id", () => {
        expect(findCardEntry(set, Card("card-missing"))).toBeUndefined();
    });
});

describe("cardName", () => {
    test("returns the display name when the id is known", () => {
        expect(cardName(set, knifeId)).toBe("Knife");
    });

    test("falls back to the id string when unknown", () => {
        const missing = Card("card-missing");
        expect(cardName(set, missing)).toBe("card-missing");
    });
});

describe("categoryName", () => {
    test("returns the display name when the id is known", () => {
        expect(categoryName(set, roomId)).toBe("Room");
    });

    test("falls back to the id string when unknown", () => {
        const missing = CardCategory("cat-missing");
        expect(categoryName(set, missing)).toBe("cat-missing");
    });
});

describe("cardIdsInCategory", () => {
    test("returns the card ids in insertion order", () => {
        expect(cardIdsInCategory(set, weaponId)).toEqual([knifeId, ropeId]);
    });

    test("returns [] for an unknown category", () => {
        expect(cardIdsInCategory(set, CardCategory("cat-missing"))).toEqual([]);
    });
});

describe("allCardIds", () => {
    test("returns every card id across all categories, in order", () => {
        expect(allCardIds(set)).toEqual([knifeId, ropeId, kitchenId, hallId]);
    });

    test("returns [] for an empty CardSet", () => {
        expect(allCardIds(CardSet({ categories: [] }))).toEqual([]);
    });
});

describe("allCardEntries", () => {
    test("returns every CardEntry across all categories, in order", () => {
        const entries = allCardEntries(set);
        expect(entries.map(e => e.id)).toEqual([
            knifeId,
            ropeId,
            kitchenId,
            hallId,
        ]);
    });
});

describe("categoryOfCard", () => {
    test("returns the owning category id for a card", () => {
        expect(categoryOfCard(set, knifeId)).toBe(weaponId);
        expect(categoryOfCard(set, hallId)).toBe(roomId);
    });

    test("returns undefined when no category owns the card", () => {
        expect(categoryOfCard(set, Card("card-missing"))).toBeUndefined();
    });
});

describe("caseFileSize", () => {
    test("equals the number of categories", () => {
        expect(caseFileSize(set)).toBe(2);
    });

    test("returns 0 for an empty CardSet", () => {
        expect(caseFileSize(CardSet({ categories: [] }))).toBe(0);
    });
});
