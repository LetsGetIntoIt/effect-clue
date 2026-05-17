import { beforeEach, describe, expect, test } from "vitest";
import { CardEntry, CardSet, Category } from "../logic/CardSet";
import { Card, CardCategory } from "../logic/GameObjects";
import {
    clearNewCardPackDraft,
    loadNewCardPackDraft,
    NEW_CARD_PACK_DRAFT_KEY,
    saveNewCardPackDraft,
} from "./newCardPackDraft";

const sampleCardSet = (): CardSet =>
    CardSet({
        categories: [
            Category({
                id: CardCategory("category-suspect"),
                name: "Suspect",
                cards: [
                    CardEntry({
                        id: Card("card-scarlet"),
                        name: "Miss Scarlet",
                    }),
                    CardEntry({
                        id: Card("card-mustard"),
                        name: "Colonel Mustard",
                    }),
                ],
            }),
        ],
    });

describe("newCardPackDraft localStorage slot", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test("loadNewCardPackDraft returns undefined when key absent", () => {
        expect(loadNewCardPackDraft()).toBeUndefined();
    });

    test("round-trip: save → load returns the same label + cardSet shape", () => {
        const cardSet = sampleCardSet();
        saveNewCardPackDraft({ label: "Office pack", cardSet });

        const loaded = loadNewCardPackDraft();
        expect(loaded).toBeDefined();
        expect(loaded!.label).toBe("Office pack");
        expect(loaded!.cardSet.categories.length).toBe(1);
        expect(loaded!.cardSet.categories[0]!.name).toBe("Suspect");
        expect(loaded!.cardSet.categories[0]!.cards.length).toBe(2);
        expect(loaded!.cardSet.categories[0]!.cards[0]!.name).toBe(
            "Miss Scarlet",
        );
    });

    test("save overwrites the previous draft (single-slot semantics)", () => {
        saveNewCardPackDraft({
            label: "First",
            cardSet: CardSet({ categories: [] }),
        });
        saveNewCardPackDraft({
            label: "Second",
            cardSet: CardSet({ categories: [] }),
        });
        expect(loadNewCardPackDraft()?.label).toBe("Second");
    });

    test("clearNewCardPackDraft removes the key", () => {
        saveNewCardPackDraft({
            label: "Disposable",
            cardSet: CardSet({ categories: [] }),
        });
        expect(loadNewCardPackDraft()).toBeDefined();
        clearNewCardPackDraft();
        expect(loadNewCardPackDraft()).toBeUndefined();
        expect(
            window.localStorage.getItem(NEW_CARD_PACK_DRAFT_KEY),
        ).toBeNull();
    });

    test("malformed JSON wipes the key and returns undefined", () => {
        window.localStorage.setItem(NEW_CARD_PACK_DRAFT_KEY, "{not json");
        expect(loadNewCardPackDraft()).toBeUndefined();
        expect(
            window.localStorage.getItem(NEW_CARD_PACK_DRAFT_KEY),
        ).toBeNull();
    });

    test("schema decode failure (wrong version) wipes the key and returns undefined", () => {
        window.localStorage.setItem(
            NEW_CARD_PACK_DRAFT_KEY,
            JSON.stringify({ version: 2, label: "x", categories: [] }),
        );
        expect(loadNewCardPackDraft()).toBeUndefined();
        expect(
            window.localStorage.getItem(NEW_CARD_PACK_DRAFT_KEY),
        ).toBeNull();
    });

    test("empty categories array round-trips correctly", () => {
        // The "blank start" case — user opened the editor and made
        // no edits yet. The draft persists the blank state.
        saveNewCardPackDraft({
            label: "",
            cardSet: CardSet({ categories: [] }),
        });
        const loaded = loadNewCardPackDraft();
        expect(loaded?.label).toBe("");
        expect(loaded?.cardSet.categories.length).toBe(0);
    });
});
