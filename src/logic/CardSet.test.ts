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
    cardSetEquals,
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

describe("cardSetEquals", () => {
    // Helper: build a set with arbitrary ids but the given names so we
    // can prove equality is name-based, not id-based.
    const make = (
        cats: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly cards: ReadonlyArray<{ id: string; name: string }>;
        }>,
    ): CardSet =>
        CardSet({
            categories: cats.map(c =>
                Category({
                    id: CardCategory(c.id),
                    name: c.name,
                    cards: c.cards.map(card =>
                        CardEntry({ id: Card(card.id), name: card.name }),
                    ),
                }),
            ),
        });

    test("identical sets are equal", () => {
        expect(cardSetEquals(set, set)).toBe(true);
    });

    test("two structurally identical sets with different ids are equal", () => {
        const a = make([
            {
                id: "id-w-1",
                name: "Weapon",
                cards: [
                    { id: "k-1", name: "Knife" },
                    { id: "r-1", name: "Rope" },
                ],
            },
        ]);
        const b = make([
            {
                id: "id-w-2",
                name: "Weapon",
                cards: [
                    { id: "k-2", name: "Knife" },
                    { id: "r-2", name: "Rope" },
                ],
            },
        ]);
        expect(cardSetEquals(a, b)).toBe(true);
    });

    test("renaming a card breaks equality", () => {
        const a = make([
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Knife" }],
            },
        ]);
        const b = make([
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Dagger" }],
            },
        ]);
        expect(cardSetEquals(a, b)).toBe(false);
    });

    test("renaming a category breaks equality", () => {
        const a = make([
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Knife" }],
            },
        ]);
        const b = make([
            {
                id: "w",
                name: "Tool",
                cards: [{ id: "k", name: "Knife" }],
            },
        ]);
        expect(cardSetEquals(a, b)).toBe(false);
    });

    test("adding a card breaks equality", () => {
        const a = make([
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Knife" }],
            },
        ]);
        const b = make([
            {
                id: "w",
                name: "Weapon",
                cards: [
                    { id: "k", name: "Knife" },
                    { id: "r", name: "Rope" },
                ],
            },
        ]);
        expect(cardSetEquals(a, b)).toBe(false);
    });

    test("removing a card breaks equality", () => {
        const a = make([
            {
                id: "w",
                name: "Weapon",
                cards: [
                    { id: "k", name: "Knife" },
                    { id: "r", name: "Rope" },
                ],
            },
        ]);
        const b = make([
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Knife" }],
            },
        ]);
        expect(cardSetEquals(a, b)).toBe(false);
    });

    test("reordering cards within a category breaks equality", () => {
        const a = make([
            {
                id: "w",
                name: "Weapon",
                cards: [
                    { id: "k", name: "Knife" },
                    { id: "r", name: "Rope" },
                ],
            },
        ]);
        const b = make([
            {
                id: "w",
                name: "Weapon",
                cards: [
                    { id: "r", name: "Rope" },
                    { id: "k", name: "Knife" },
                ],
            },
        ]);
        expect(cardSetEquals(a, b)).toBe(false);
    });

    test("reordering categories breaks equality", () => {
        const a = make([
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Knife" }],
            },
            {
                id: "r",
                name: "Room",
                cards: [{ id: "kt", name: "Kitchen" }],
            },
        ]);
        const b = make([
            {
                id: "r",
                name: "Room",
                cards: [{ id: "kt", name: "Kitchen" }],
            },
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Knife" }],
            },
        ]);
        expect(cardSetEquals(a, b)).toBe(false);
    });

    test("two empty card sets are equal", () => {
        const a = CardSet({ categories: [] });
        const b = CardSet({ categories: [] });
        expect(cardSetEquals(a, b)).toBe(true);
    });

    test("an empty set is not equal to a non-empty set", () => {
        const a = CardSet({ categories: [] });
        const b = make([
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Knife" }],
            },
        ]);
        expect(cardSetEquals(a, b)).toBe(false);
        expect(cardSetEquals(b, a)).toBe(false);
    });

    test("two sets with the same category but no cards are equal", () => {
        const a = make([{ id: "w", name: "Weapon", cards: [] }]);
        const b = make([{ id: "w-other", name: "Weapon", cards: [] }]);
        expect(cardSetEquals(a, b)).toBe(true);
    });

    test("differing category counts are not equal", () => {
        const a = make([
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Knife" }],
            },
        ]);
        const b = make([
            {
                id: "w",
                name: "Weapon",
                cards: [{ id: "k", name: "Knife" }],
            },
            {
                id: "r",
                name: "Room",
                cards: [{ id: "kt", name: "Kitchen" }],
            },
        ]);
        expect(cardSetEquals(a, b)).toBe(false);
    });
});
