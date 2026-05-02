import { beforeEach, describe, expect, test, vi } from "vitest";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { Player } from "./GameObjects";
import { cardByName } from "./test-utils/CardByName";
import {
    Accusation,
    AccusationId,
    newAccusationId,
} from "./Accusation";
import { newSuggestionId, Suggestion, SuggestionId } from "./Suggestion";
import {
    decodeSession,
    encodeSession,
    loadFromLocalStorage,
    saveToLocalStorage,
    type GameSession,
} from "./Persistence";

const STORAGE_KEY = "effect-clue.session.v6";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");
const MUSTARD = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");
const PLUM = cardByName(setup, "Prof. Plum");
const ROPE = cardByName(setup, "Rope");

const minimalSession: GameSession = {
    setup,
    hands: [{ player: A, cards: [KNIFE] }],
    handSizes: [
        { player: A, size: 6 },
        { player: B, size: 6 },
        { player: C, size: 6 },
    ],
    suggestions: [],
    accusations: [],
};

const richSession = (): GameSession => ({
    setup,
    hands: [
        { player: A, cards: [KNIFE, KITCHEN] },
        { player: B, cards: [MUSTARD] },
    ],
    handSizes: [
        { player: A, size: 2 },
        { player: B, size: 1 },
        { player: C, size: 0 },
    ],
    suggestions: [
        // Unrefuted suggestion
        Suggestion({
            id: newSuggestionId(),
            suggester: A,
            cards: [MUSTARD, KNIFE, KITCHEN],
            nonRefuters: [B, C],
        }),
        // Refuted, no seen card
        Suggestion({
            id: newSuggestionId(),
            suggester: B,
            cards: [PLUM, ROPE, KITCHEN],
            nonRefuters: [],
            refuter: A,
        }),
        // Refuted with a seen card
        Suggestion({
            id: newSuggestionId(),
            suggester: C,
            cards: [PLUM, KNIFE, KITCHEN],
            nonRefuters: [A],
            refuter: B,
            seenCard: KNIFE,
        }),
    ],
    accusations: [
        Accusation({
            id: newAccusationId(),
            accuser: A,
            cards: [PLUM, ROPE, KITCHEN],
        }),
        Accusation({
            id: newAccusationId(),
            accuser: B,
            cards: [MUSTARD, KNIFE, KITCHEN],
        }),
    ],
});

describe("encode/decode — rich sessions", () => {
    test("round-trips a session with unrefuted, refuted-no-seen, and refuted-with-seen suggestions", () => {
        const s = richSession();
        const decoded = decodeSession(encodeSession(s));
        expect(decoded).toBeDefined();
        expect(decoded?.suggestions).toHaveLength(3);
        // Each suggestion preserves its refuter / seenCard exactly.
        expect(decoded?.suggestions[0]?.refuter).toBeUndefined();
        expect(decoded?.suggestions[0]?.seenCard).toBeUndefined();
        expect(decoded?.suggestions[1]?.refuter).toBe(A);
        expect(decoded?.suggestions[1]?.seenCard).toBeUndefined();
        expect(decoded?.suggestions[2]?.refuter).toBe(B);
        expect(decoded?.suggestions[2]?.seenCard).toBe(KNIFE);
    });

    test("round-trips hand assignments faithfully", () => {
        const s = richSession();
        const decoded = decodeSession(encodeSession(s));
        expect(decoded?.hands).toHaveLength(2);
        expect(decoded?.hands[0]?.cards).toHaveLength(2);
        expect(decoded?.hands[1]?.cards).toHaveLength(1);
    });

    test("generates a fresh SuggestionId when the persisted id is the empty sentinel", () => {
        const encoded = encodeSession({
            ...minimalSession,
            suggestions: [
                Suggestion({
                    id: SuggestionId(""),
                    suggester: A,
                    cards: [MUSTARD, KNIFE, KITCHEN],
                    nonRefuters: [],
                }),
            ],
        });
        const decoded = decodeSession(encoded);
        const id = decoded?.suggestions[0]?.id;
        expect(id).toBeDefined();
        expect(id).not.toBe(SuggestionId(""));
        // Fresh id gets the `suggestion-` prefix from `newSuggestionId`.
        expect(String(id)).toMatch(/^suggestion-/);
    });

    test("round-trips accusations with accuser and cards intact", () => {
        const s = richSession();
        const decoded = decodeSession(encodeSession(s));
        expect(decoded?.accusations).toHaveLength(2);
        expect(decoded?.accusations[0]?.accuser).toBe(A);
        expect(decoded?.accusations[1]?.accuser).toBe(B);
    });

    test("generates a fresh AccusationId when the persisted id is the empty sentinel", () => {
        const encoded = encodeSession({
            ...minimalSession,
            accusations: [
                Accusation({
                    id: AccusationId(""),
                    accuser: A,
                    cards: [MUSTARD, KNIFE, KITCHEN],
                }),
            ],
        });
        const decoded = decodeSession(encoded);
        const id = decoded?.accusations[0]?.id;
        expect(id).toBeDefined();
        expect(id).not.toBe(AccusationId(""));
        expect(String(id)).toMatch(/^accusation-/);
    });

    test("decodeSession rejects older payloads (no migration chain)", () => {
        // Older session formats no longer parse — the v6 schema requires
        // `loggedAt` on each suggestion + accusation. The caller falls
        // back to a fresh session on any unrecognized input.
        const olderPayload = {
            version: 5,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
        };
        expect(decodeSession(olderPayload)).toBeUndefined();
    });
});

describe("saveToLocalStorage / loadFromLocalStorage", () => {
    beforeEach(() => window.localStorage.clear());

    test("save followed by load recovers the session", () => {
        saveToLocalStorage(minimalSession);
        const loaded = loadFromLocalStorage();
        expect(loaded).toBeDefined();
        expect(loaded?.handSizes).toHaveLength(3);
    });

    test("save writes under the v6-scoped storage key", () => {
        saveToLocalStorage(minimalSession);
        const raw = window.localStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw as string).version).toBe(6);
    });

    test("load returns undefined when the key is missing", () => {
        expect(loadFromLocalStorage()).toBeUndefined();
    });

    test("load returns undefined for corrupt JSON", () => {
        window.localStorage.setItem(STORAGE_KEY, "{{{not json");
        expect(loadFromLocalStorage()).toBeUndefined();
    });

    test("load returns undefined when decoding fails (wrong shape)", () => {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 99, nope: true }),
        );
        expect(loadFromLocalStorage()).toBeUndefined();
    });

    test("save swallows quota-exceeded errors without throwing", () => {
        const spy = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new DOMException("QuotaExceededError");
            });
        expect(() => saveToLocalStorage(minimalSession)).not.toThrow();
        spy.mockRestore();
    });

    test("save overwrites a prior session at the same key", () => {
        saveToLocalStorage(minimalSession);
        const updated: GameSession = {
            ...minimalSession,
            handSizes: [{ player: A, size: 99 }],
        };
        saveToLocalStorage(updated);
        const loaded = loadFromLocalStorage();
        expect(loaded?.handSizes).toHaveLength(1);
        expect(loaded?.handSizes[0]?.size).toBe(99);
    });
});

