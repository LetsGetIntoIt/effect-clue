import { describe, expect, test } from "vitest";
import { Equal, HashSet } from "effect";
import { Player } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { cardByName } from "./test-utils/CardByName";
import {
    newSuggestionId,
    Suggestion,
    SuggestionId,
    suggestionCards,
    suggestionNonRefuters,
} from "./Suggestion";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

describe("newSuggestionId", () => {
    test("produces a branded SuggestionId prefixed with `suggestion-`", () => {
        const id = newSuggestionId();
        expect(String(id)).toMatch(/^suggestion-/);
    });

    test("produces unique ids across many calls", () => {
        const ids = new Set<string>();
        for (let i = 0; i < 1000; i++) ids.add(String(newSuggestionId()));
        expect(ids.size).toBe(1000);
    });
});

describe("Suggestion constructor", () => {
    test("builds a suggestion with required fields only", () => {
        const s = Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
        });
        expect(s.suggester).toBe(A);
        expect(HashSet.has(s.cards, KNIFE)).toBe(true);
        expect(HashSet.size(s.cards)).toBe(3);
        expect(HashSet.size(s.nonRefuters)).toBe(0);
        expect(s.refuter).toBeUndefined();
        expect(s.seenCard).toBeUndefined();
    });

    test("defaults id to the empty-string sentinel when not supplied", () => {
        const s = Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
        });
        expect(s.id).toBe(SuggestionId(""));
    });

    test("accepts an explicit id", () => {
        const id = SuggestionId("explicit-id");
        const s = Suggestion({
            id,
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
        });
        expect(s.id).toBe(id);
    });

    test("stores refuter and seenCard when provided", () => {
        const s = Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
            refuter: B,
            seenCard: KNIFE,
        });
        expect(s.refuter).toBe(B);
        expect(s.seenCard).toBe(KNIFE);
    });

    test("stores nonRefuters as a HashSet", () => {
        const s = Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B, C],
        });
        expect(HashSet.has(s.nonRefuters, B)).toBe(true);
        expect(HashSet.has(s.nonRefuters, C)).toBe(true);
        expect(HashSet.size(s.nonRefuters)).toBe(2);
    });

    test("deduplicates cards passed in the iterable", () => {
        const s = Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KNIFE, KITCHEN],
            nonRefuters: [],
        });
        expect(HashSet.size(s.cards)).toBe(3);
    });

    test("deduplicates nonRefuters passed in the iterable", () => {
        const s = Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B, B, C],
        });
        expect(HashSet.size(s.nonRefuters)).toBe(2);
    });

    test("two suggestions with structurally-equal fields are Equal.equals", () => {
        const s1 = Suggestion({
            id: SuggestionId("dup"),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B],
            refuter: C,
            seenCard: KNIFE,
        });
        const s2 = Suggestion({
            id: SuggestionId("dup"),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B],
            refuter: C,
            seenCard: KNIFE,
        });
        expect(Equal.equals(s1, s2)).toBe(true);
    });

    test("card order in the iterable doesn't affect equality", () => {
        const s1 = Suggestion({
            id: SuggestionId("order"),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
        });
        const s2 = Suggestion({
            id: SuggestionId("order"),
            suggester: A,
            cards: [KITCHEN, MUSTARD, KNIFE],
            nonRefuters: [],
        });
        expect(Equal.equals(s1, s2)).toBe(true);
    });

    test("a different refuter breaks equality", () => {
        const base = {
            id: SuggestionId("x"),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
        };
        const s1 = Suggestion({ ...base, refuter: B });
        const s2 = Suggestion({ ...base, refuter: C });
        expect(Equal.equals(s1, s2)).toBe(false);
    });
});

describe("suggestionCards", () => {
    test("returns the cards as an array", () => {
        const s = Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
        });
        const out = suggestionCards(s);
        expect(out).toHaveLength(3);
        expect(out).toContain(MUSTARD);
        expect(out).toContain(KNIFE);
        expect(out).toContain(KITCHEN);
    });

    test("returns an empty array when cards is empty", () => {
        const s = Suggestion({ suggester: A, cards: [], nonRefuters: [] });
        expect(suggestionCards(s)).toEqual([]);
    });
});

describe("suggestionNonRefuters", () => {
    test("returns the explicit passers as an array", () => {
        const s = Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B, C],
        });
        const out = suggestionNonRefuters(s);
        expect(out).toHaveLength(2);
        expect(out).toContain(B);
        expect(out).toContain(C);
    });

    test("returns an empty array when no passers were recorded", () => {
        const s = Suggestion({
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [],
        });
        expect(suggestionNonRefuters(s)).toEqual([]);
    });
});
