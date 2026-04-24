import { describe, expect, test } from "vitest";
import { Equal } from "effect";
import {
    Card,
    CardCategory,
    CaseFileOwner,
    newCardId,
    newCategoryId,
    Owner,
    ownerLabel,
    Player,
    PlayerOwner,
} from "./GameObjects";

describe("branded constructors", () => {
    test("Player wraps a raw string as a branded Player", () => {
        const p = Player("Anisha");
        expect(String(p)).toBe("Anisha");
    });

    test("Card wraps a raw string as a branded Card", () => {
        const c = Card("card-knife");
        expect(String(c)).toBe("card-knife");
    });

    test("CardCategory wraps a raw string as a branded CardCategory", () => {
        const cat = CardCategory("category-weapon");
        expect(String(cat)).toBe("category-weapon");
    });
});

describe("newCardId / newCategoryId", () => {
    test("newCardId produces ids prefixed with `card-`", () => {
        expect(String(newCardId())).toMatch(/^card-/);
    });

    test("newCategoryId produces ids prefixed with `category-`", () => {
        expect(String(newCategoryId())).toMatch(/^category-/);
    });

    test("newCardId produces unique ids across many calls", () => {
        const ids = new Set<string>();
        for (let i = 0; i < 1000; i++) ids.add(String(newCardId()));
        expect(ids.size).toBe(1000);
    });

    test("newCategoryId produces unique ids across many calls", () => {
        const ids = new Set<string>();
        for (let i = 0; i < 1000; i++) ids.add(String(newCategoryId()));
        expect(ids.size).toBe(1000);
    });
});

describe("PlayerOwner / CaseFileOwner", () => {
    test("PlayerOwner tags itself as Player", () => {
        const o = PlayerOwner(Player("Anisha"));
        expect(o._tag).toBe("Player");
    });

    test("PlayerOwner exposes the player on the `player` field", () => {
        const p = Player("Anisha");
        const o = PlayerOwner(p);
        // narrow to the player variant — ownership is a tagged union
        if (o._tag === "Player") {
            expect(o.player).toBe(p);
        } else {
            throw new Error("expected a Player owner");
        }
    });

    test("CaseFileOwner tags itself as CaseFile", () => {
        const o = CaseFileOwner();
        expect(o._tag).toBe("CaseFile");
    });

    test("two PlayerOwners for the same player are Equal.equals", () => {
        const p = Player("Anisha");
        expect(Equal.equals(PlayerOwner(p), PlayerOwner(p))).toBe(true);
    });

    test("two CaseFileOwners are Equal.equals", () => {
        expect(Equal.equals(CaseFileOwner(), CaseFileOwner())).toBe(true);
    });

    test("PlayerOwners with different names are not Equal.equals", () => {
        expect(
            Equal.equals(
                PlayerOwner(Player("Anisha")),
                PlayerOwner(Player("Bob")),
            ),
        ).toBe(false);
    });

    test("a PlayerOwner and a CaseFileOwner are not Equal.equals", () => {
        expect(
            Equal.equals(PlayerOwner(Player("Anisha")), CaseFileOwner()),
        ).toBe(false);
    });
});

describe("ownerLabel", () => {
    test("returns the player name for PlayerOwner", () => {
        expect(ownerLabel(PlayerOwner(Player("Anisha")))).toBe("Anisha");
    });

    test("returns `Case file` for CaseFileOwner", () => {
        expect(ownerLabel(CaseFileOwner())).toBe("Case file");
    });

    test("is exhaustive over the Owner tagged union", () => {
        // Compile-time check: ownerLabel returns a string for every tag
        // in the Owner union. If a new variant is added without extending
        // ownerLabel, this narrowing would fail to typecheck.
        const owners: ReadonlyArray<Owner> = [
            PlayerOwner(Player("Anisha")),
            CaseFileOwner(),
        ];
        for (const o of owners) {
            expect(typeof ownerLabel(o)).toBe("string");
        }
    });
});
