import { describe, expect, test } from "vitest";
import { Equal, HashSet } from "effect";
import { Player } from "./GameObjects";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { cardByName } from "./test-utils/CardByName";
import {
    Accusation,
    AccusationId,
    accusationCards,
    newAccusationId,
} from "./Accusation";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

describe("newAccusationId", () => {
    test("produces a branded AccusationId prefixed with `accusation-`", () => {
        const id = newAccusationId();
        expect(String(id)).toMatch(/^accusation-/);
    });

    test("produces unique ids across many calls", () => {
        const ids = new Set<string>();
        for (let i = 0; i < 1000; i++) ids.add(String(newAccusationId()));
        expect(ids.size).toBe(1000);
    });
});

describe("Accusation constructor", () => {
    test("builds an accusation with required fields only", () => {
        const a = Accusation({
            accuser: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
        });
        expect(a.accuser).toBe(A);
        expect(HashSet.has(a.cards, KNIFE)).toBe(true);
        expect(HashSet.size(a.cards)).toBe(3);
    });

    test("defaults id to the empty-string sentinel when not supplied", () => {
        const a = Accusation({
            accuser: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
        });
        expect(a.id).toBe(AccusationId(""));
    });

    test("accepts an explicit id", () => {
        const id = AccusationId("explicit-id");
        const a = Accusation({
            id,
            accuser: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
        });
        expect(a.id).toBe(id);
    });

    test("deduplicates cards passed in the iterable", () => {
        const a = Accusation({
            accuser: A,
            cards: [MUSTARD, KNIFE, KNIFE, KITCHEN],
        });
        expect(HashSet.size(a.cards)).toBe(3);
    });

    test("two accusations with structurally-equal fields are Equal.equals", () => {
        const a1 = Accusation({
            id: AccusationId("dup"),
            accuser: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
        });
        const a2 = Accusation({
            id: AccusationId("dup"),
            accuser: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
        });
        expect(Equal.equals(a1, a2)).toBe(true);
    });

    test("card order in the iterable doesn't affect equality", () => {
        const a1 = Accusation({
            id: AccusationId("order"),
            accuser: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
        });
        const a2 = Accusation({
            id: AccusationId("order"),
            accuser: A,
            cards: [KITCHEN, MUSTARD, KNIFE],
        });
        expect(Equal.equals(a1, a2)).toBe(true);
    });

    test("a different accuser breaks equality", () => {
        const base = {
            id: AccusationId("x"),
            cards: [MUSTARD, KNIFE, KITCHEN],
        };
        const a1 = Accusation({ ...base, accuser: A });
        const a2 = Accusation({ ...base, accuser: B });
        expect(Equal.equals(a1, a2)).toBe(false);
    });

    test("a different cards set breaks equality", () => {
        const base = {
            id: AccusationId("x"),
            accuser: A,
        };
        const a1 = Accusation({ ...base, cards: [MUSTARD, KNIFE, KITCHEN] });
        const a2 = Accusation({ ...base, cards: [MUSTARD, KNIFE] });
        expect(Equal.equals(a1, a2)).toBe(false);
    });
});

describe("accusationCards", () => {
    test("returns the cards as an array", () => {
        const a = Accusation({
            accuser: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
        });
        const out = accusationCards(a);
        expect(out).toHaveLength(3);
        expect(out).toContain(MUSTARD);
        expect(out).toContain(KNIFE);
        expect(out).toContain(KITCHEN);
    });

    test("returns an empty array when cards is empty", () => {
        const a = Accusation({ accuser: A, cards: [] });
        expect(accusationCards(a)).toEqual([]);
    });
});
