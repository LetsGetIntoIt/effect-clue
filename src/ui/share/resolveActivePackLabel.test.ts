/**
 * The receive-modal "Card pack: My Cool Deck (custom)" line depends
 * on the wire payload's `name` field, which the sender only embeds
 * when the create-side modal knows the active pack's label. Invite
 * and transfer openers don't pass a forced label; this helper recovers
 * it from the most-recently-used custom pack whose contents still
 * match the live deck.
 */
import { DateTime } from "effect";
import { describe, expect, test } from "vitest";
import { Card, CardCategory } from "../../logic/GameObjects";
import { CardSet, CardEntry, Category } from "../../logic/CardSet";
import type { CustomCardSet } from "../../logic/CustomCardSets";
import { resolveActivePackLabel } from "./resolveActivePackLabel";

const PACK_A = CardSet({
    categories: [
        Category({
            id: CardCategory("category-a"),
            name: "A",
            cards: [
                CardEntry({ id: Card("card-a-1"), name: "A1" }),
                CardEntry({ id: Card("card-a-2"), name: "A2" }),
            ],
        }),
    ],
});
const PACK_B = CardSet({
    categories: [
        Category({
            id: CardCategory("category-b"),
            name: "B",
            cards: [CardEntry({ id: Card("card-b-1"), name: "B1" })],
        }),
    ],
});

const customA: CustomCardSet = { id: "id-a", label: "Pack A", cardSet: PACK_A };
const customB: CustomCardSet = { id: "id-b", label: "Pack B", cardSet: PACK_B };

const usageOf = (
    entries: ReadonlyArray<readonly [string, string]>,
): ReadonlyMap<string, DateTime.Utc> =>
    new Map(
        entries.map(([id, iso]) => [
            id,
            DateTime.makeUnsafe(new Date(iso).getTime()),
        ]),
    );

describe("resolveActivePackLabel", () => {
    test("explicit label wins (picker-supplied label is authoritative)", () => {
        expect(
            resolveActivePackLabel(PACK_A, [customA], new Map(), "Picker"),
        ).toBe("Picker");
    });

    test("MRU custom pack whose deck still matches → returns its label", () => {
        const usage = usageOf([
            ["id-b", "2026-01-01T00:00:00Z"],
            ["id-a", "2026-01-02T00:00:00Z"], // most recent
        ]);
        expect(
            resolveActivePackLabel(
                PACK_A,
                [customA, customB],
                usage,
                undefined,
            ),
        ).toBe("Pack A");
    });

    test("MRU pack whose deck no longer matches the live setup → undefined", () => {
        // User loaded Pack A, then edited it. Live deck (PACK_B-shaped)
        // no longer matches the saved pack contents.
        const usage = usageOf([["id-a", "2026-01-02T00:00:00Z"]]);
        expect(
            resolveActivePackLabel(PACK_B, [customA], usage, undefined),
        ).toBeUndefined();
    });

    test("MRU id is a built-in (not in customPacks) → undefined", () => {
        // We don't need to embed names for built-in packs — receivers
        // detect them by structural equality.
        const usage = usageOf([["builtin-classic", "2026-01-02T00:00:00Z"]]);
        expect(
            resolveActivePackLabel(PACK_A, [customA], usage, undefined),
        ).toBeUndefined();
    });

    test("empty explicit string is treated as no explicit label", () => {
        const usage = usageOf([["id-a", "2026-01-02T00:00:00Z"]]);
        expect(
            resolveActivePackLabel(PACK_A, [customA], usage, ""),
        ).toBe("Pack A");
    });

    test("empty usage map and no explicit → undefined", () => {
        expect(
            resolveActivePackLabel(PACK_A, [customA], new Map(), undefined),
        ).toBeUndefined();
    });
});
