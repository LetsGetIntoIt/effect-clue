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
import { emptyHypotheses } from "./Hypothesis";
import { emptyUserDeductions } from "./TeachMode";

const STORAGE_KEY = "effect-clue.session.v12";
const LEGACY_STORAGE_KEY_V10 = "effect-clue.session.v10";
const LEGACY_STORAGE_KEY_V9 = "effect-clue.session.v9";
const LEGACY_STORAGE_KEY_V8 = "effect-clue.session.v8";
const LEGACY_STORAGE_KEY_V7 = "effect-clue.session.v7";
const LEGACY_STORAGE_KEY_V6 = "effect-clue.session.v6";

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
    hypotheses: emptyHypotheses,
    hypothesisOrder: [],
    pendingSuggestion: null,
    selfPlayerId: null,
    firstDealtPlayerId: null,
    dismissedInsights: new Map(),
    teachMode: false,
    userDeductions: emptyUserDeductions,
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
    hypotheses: emptyHypotheses,
    hypothesisOrder: [],
    pendingSuggestion: null,
    selfPlayerId: null,
    firstDealtPlayerId: null,
    dismissedInsights: new Map(),
    teachMode: false,
    userDeductions: emptyUserDeductions,
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

    test("save writes under the v12-scoped storage key", () => {
        saveToLocalStorage(minimalSession);
        const raw = window.localStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw as string).version).toBe(12);
    });

    test("loads a v10 blob and lifts to v11 with hypothesisOrder derived from the v10 hypotheses array", () => {
        // v10 lacked `hypothesisOrder`; the lift derives it from the
        // v10 `hypotheses` array's iteration order — that's the order
        // the user last saw rendered, so it's the natural seed value.
        const v10Payload = {
            version: 10,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
            hypotheses: [],
            pendingSuggestion: null,
            selfPlayerId: null,
            firstDealtPlayerId: null,
            dismissedInsights: [],
            teachMode: false,
            userDeductions: emptyUserDeductions,
        };
        window.localStorage.setItem(
            LEGACY_STORAGE_KEY_V10,
            JSON.stringify(v10Payload),
        );
        const loaded = loadFromLocalStorage();
        expect(loaded).toBeDefined();
        expect(loaded?.hypothesisOrder).toEqual([]);
    });

    test("loads a v9 blob and lifts to v10 with empty dismissedInsights", () => {
        // v9 lacked `dismissedInsights`. The lift defaults to an empty
        // map — the same value a fresh game produces.
        const v9Payload = {
            version: 9,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
            hypotheses: [],
            pendingSuggestion: null,
            selfPlayerId: null,
            firstDealtPlayerId: null,
        };
        window.localStorage.setItem(
            LEGACY_STORAGE_KEY_V9,
            JSON.stringify(v9Payload),
        );
        const loaded = loadFromLocalStorage();
        expect(loaded).toBeDefined();
        expect(loaded?.dismissedInsights.size).toBe(0);
    });

    test("loads a v8 blob and lifts to v10 with empty dismissedInsights and null identity", () => {
        // v8 lacked `selfPlayerId` and `firstDealtPlayerId`. The lift
        // defaults both to null — same value the M6 wizard produces
        // when the user skips the identity step on a fresh game.
        const v8Payload = {
            version: 8,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
            hypotheses: [],
            pendingSuggestion: null,
        };
        window.localStorage.setItem(
            LEGACY_STORAGE_KEY_V8,
            JSON.stringify(v8Payload),
        );
        const loaded = loadFromLocalStorage();
        expect(loaded).toBeDefined();
        expect(loaded?.selfPlayerId).toBeNull();
        expect(loaded?.firstDealtPlayerId).toBeNull();
    });

    test("loads a v7 blob (no pendingSuggestion field) and lifts to v8 with null draft", () => {
        const v7Payload = {
            version: 7,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
            hypotheses: [],
        };
        window.localStorage.setItem(
            LEGACY_STORAGE_KEY_V7,
            JSON.stringify(v7Payload),
        );
        const loaded = loadFromLocalStorage();
        expect(loaded).toBeDefined();
        expect(loaded?.pendingSuggestion).toBeNull();
    });

    test("loads a v6 blob (no hypotheses field) and lifts to v7 with empty hypotheses", () => {
        const v6Payload = {
            version: 6,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
        };
        window.localStorage.setItem(
            LEGACY_STORAGE_KEY_V6,
            JSON.stringify(v6Payload),
        );
        const loaded = loadFromLocalStorage();
        expect(loaded).toBeDefined();
        expect(loaded?.hypotheses).toBeDefined();
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

// ---------------------------------------------------------------------------
// pendingSuggestion round-trip (M2)
//
// Each optional slot has three runtime states (null / Nobody / value).
// The persisted form uses paired `*Decided` + `*IsNobody` flags so they
// all round-trip without `Schema.Union`. Each combination is exercised
// here to make sure the encoder + decoder agree on every distinguishable
// state.
// ---------------------------------------------------------------------------
describe("pendingSuggestion round-trip", () => {
    const NOBODY_DRAFT = { kind: "nobody" as const };

    test("null pendingSuggestion round-trips as null", () => {
        const decoded = decodeSession(encodeSession(minimalSession));
        expect(decoded?.pendingSuggestion).toBeNull();
    });

    test("a draft with all optional slots undecided round-trips", () => {
        const session: GameSession = {
            ...minimalSession,
            pendingSuggestion: {
                id: "draft-1",
                suggester: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                nonRefuters: null,
                refuter: null,
                seenCard: null,
            },
        };
        const decoded = decodeSession(encodeSession(session));
        expect(decoded?.pendingSuggestion).toEqual(session.pendingSuggestion);
    });

    test("a draft with explicit-Nobody slots round-trips Nobody markers, not null", () => {
        const session: GameSession = {
            ...minimalSession,
            pendingSuggestion: {
                id: "draft-2",
                suggester: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                nonRefuters: NOBODY_DRAFT,
                refuter: NOBODY_DRAFT,
                seenCard: NOBODY_DRAFT,
            },
        };
        const decoded = decodeSession(encodeSession(session));
        // Each slot decodes back to a Nobody marker, not null and not a value.
        expect(decoded?.pendingSuggestion?.nonRefuters).toEqual(NOBODY_DRAFT);
        expect(decoded?.pendingSuggestion?.refuter).toEqual(NOBODY_DRAFT);
        expect(decoded?.pendingSuggestion?.seenCard).toEqual(NOBODY_DRAFT);
    });

    test("a draft with concrete values in optional slots round-trips them faithfully", () => {
        const session: GameSession = {
            ...minimalSession,
            pendingSuggestion: {
                id: "draft-3",
                suggester: A,
                cards: [MUSTARD, KNIFE, KITCHEN],
                nonRefuters: [B, C],
                refuter: B,
                seenCard: KNIFE,
            },
        };
        const decoded = decodeSession(encodeSession(session));
        expect(decoded?.pendingSuggestion?.nonRefuters).toEqual([B, C]);
        expect(decoded?.pendingSuggestion?.refuter).toBe(B);
        expect(decoded?.pendingSuggestion?.seenCard).toBe(KNIFE);
    });

    test("a partially-filled draft round-trips with null cards preserved", () => {
        const session: GameSession = {
            ...minimalSession,
            pendingSuggestion: {
                id: "draft-4",
                suggester: null,
                cards: [MUSTARD, null, KITCHEN],
                nonRefuters: null,
                refuter: null,
                seenCard: null,
            },
        };
        const decoded = decodeSession(encodeSession(session));
        expect(decoded?.pendingSuggestion?.suggester).toBeNull();
        expect(decoded?.pendingSuggestion?.cards).toEqual([
            MUSTARD,
            null,
            KITCHEN,
        ]);
    });

    test("v7 sessions (no pendingSuggestion field) load with null draft", () => {
        // Hand-craft a v7 payload — no `pendingSuggestion` key at all.
        const v7Payload = {
            version: 7,
            setup: { players: ["Anisha"], categories: [] },
            hands: [],
            handSizes: [],
            suggestions: [],
            accusations: [],
            hypotheses: [],
        };
        const decoded = decodeSession(v7Payload);
        expect(decoded).toBeDefined();
        expect(decoded?.pendingSuggestion).toBeNull();
    });
});

