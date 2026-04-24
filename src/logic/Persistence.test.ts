import { beforeEach, describe, expect, test, vi } from "vitest";
import { CLASSIC_SETUP_3P } from "./GameSetup";
import { Player } from "./GameObjects";
import { cardByName } from "./test-utils/CardByName";
import { newSuggestionId, Suggestion, SuggestionId } from "./Suggestion";
import {
    decodeSession,
    decodeSessionFromUrl,
    encodeSession,
    encodeSessionToUrl,
    loadFromLocalStorage,
    saveToLocalStorage,
    type GameSession,
} from "./Persistence";

const STORAGE_KEY = "effect-clue.session.v4";

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
});

describe("saveToLocalStorage / loadFromLocalStorage", () => {
    beforeEach(() => window.localStorage.clear());

    test("save followed by load recovers the session", () => {
        saveToLocalStorage(minimalSession);
        const loaded = loadFromLocalStorage();
        expect(loaded).toBeDefined();
        expect(loaded?.handSizes).toHaveLength(3);
    });

    test("save writes under the v4-scoped storage key", () => {
        saveToLocalStorage(minimalSession);
        const raw = window.localStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw as string).version).toBe(4);
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

describe("encodeSessionToUrl / decodeSessionFromUrl", () => {
    test("produces URL-safe characters only (no +, /, =)", () => {
        const encoded = encodeSessionToUrl(richSession());
        expect(encoded).not.toMatch(/[+/=]/);
    });

    test("round-trips a rich session through URL encoding", () => {
        const s = richSession();
        const decoded = decodeSessionFromUrl(encodeSessionToUrl(s));
        expect(decoded?.suggestions).toHaveLength(3);
        expect(decoded?.suggestions[2]?.seenCard).toBe(KNIFE);
    });

    test("round-trips the minimal session", () => {
        const decoded = decodeSessionFromUrl(encodeSessionToUrl(minimalSession));
        expect(decoded).toBeDefined();
        expect(decoded?.handSizes).toHaveLength(3);
    });

    test("decode returns undefined for malformed base64", () => {
        expect(decodeSessionFromUrl("!@#$")).toBeUndefined();
    });

    test("decode returns undefined when the payload decodes to non-JSON", () => {
        // `aGVsbG8` = "hello" — valid base64 but not JSON.
        expect(decodeSessionFromUrl("aGVsbG8")).toBeUndefined();
    });

    test("decode returns undefined when the JSON isn't a valid session shape", () => {
        // JSON literal `42`, base64 ("NDI=") with the padding stripped
        // the way `encodeSessionToUrl` strips it.
        expect(decodeSessionFromUrl("NDI")).toBeUndefined();
    });

    test("decode handles payloads that need `=` padding restored", () => {
        // Encode strips `=` padding; decoding must re-add it. Round-trip
        // with a session whose JSON length % 4 == 1 to force 3 `=`s
        // (minimalSession's JSON is predictable enough).
        const encoded = encodeSessionToUrl(minimalSession);
        // Sanity: encoded must not end in `=`, then decode must succeed.
        expect(encoded).not.toMatch(/=$/);
        expect(decodeSessionFromUrl(encoded)).toBeDefined();
    });
});
