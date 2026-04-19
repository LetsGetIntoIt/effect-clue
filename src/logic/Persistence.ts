import { Result } from "effect";
import { Card, CardCategory, Player } from "./GameObjects";
import { CardEntry, Category, GameSetup } from "./GameSetup";
import {
    decodeV3Unknown,
    decodeV4Unknown,
    type PersistedSessionV4,
} from "./PersistenceSchema";
import {
    newSuggestionId,
    Suggestion,
    SuggestionId,
    suggestionCards,
    suggestionNonRefuters,
} from "./Suggestion";

/**
 * JSON representation of the mutable parts of a game session. We
 * serialize just enough to reconstruct the inputs — the derived
 * knowledge is cheap to recompute so there's no need to persist it.
 *
 * Schema history:
 *   v1 — hardcoded suspects/weapons/rooms arrays.
 *   v2 — generalized to `categories` array with name + cards[]; still
 *        identified cards by their display name string.
 *   v3 — split identity from display: each category and card carries
 *        its own stable `id` alongside `name`. Suggestions, hands,
 *        etc. reference cards by id so renames don't break them.
 *   v4 — identical payload to v3, but validated via Effect v4 Schema
 *        (`PersistenceSchema.ts`). Malformed payloads now produce a
 *        structured `SchemaError` instead of silent `undefined`. Writes
 *        go to v4; legacy payloads (v1/v2/v3) keep decoding through
 *        the hand-rolled migration chain below and are re-stamped as
 *        v4 the next time they're persisted.
 */
interface PersistedGameV4 {
    readonly version: 4;
    readonly setup: PersistedGameV3["setup"];
    readonly hands: PersistedGameV3["hands"];
    readonly handSizes: PersistedGameV3["handSizes"];
    readonly suggestions: PersistedGameV3["suggestions"];
}

interface PersistedGameV3 {
    readonly version: 3;
    readonly setup: {
        readonly players: ReadonlyArray<string>;
        readonly categories: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly cards: ReadonlyArray<{
                readonly id: string;
                readonly name: string;
            }>;
        }>;
    };
    readonly hands: ReadonlyArray<{
        readonly player: string;
        readonly cards: ReadonlyArray<string>; // card ids
    }>;
    readonly handSizes: ReadonlyArray<{
        readonly player: string;
        readonly size: number;
    }>;
    readonly suggestions: ReadonlyArray<{
        readonly id?: string | undefined;
        readonly suggester: string;
        readonly cards: ReadonlyArray<string>; // card ids
        readonly nonRefuters: ReadonlyArray<string>;
        readonly refuter: string | null;
        readonly seenCard: string | null; // card id
    }>;
}

/**
 * Legacy v2 shape — card identity was the display name string.
 * On decode we migrate by using the name as the id (so existing
 * sessions/URLs keep working, and are stable from then on).
 */
interface PersistedGameV2 {
    readonly version: 2;
    readonly setup: {
        readonly players: ReadonlyArray<string>;
        readonly categories: ReadonlyArray<{
            readonly name: string;
            readonly cards: ReadonlyArray<string>;
        }>;
    };
    readonly hands: PersistedGameV3["hands"];
    readonly handSizes: PersistedGameV3["handSizes"];
    readonly suggestions: PersistedGameV3["suggestions"];
}

/**
 * Legacy v1 shape — hardcoded suspects/weapons/rooms. Kept only to let
 * `decodeSession` migrate old localStorage / URL sessions forward.
 */
interface PersistedGameV1 {
    readonly version: 1;
    readonly setup: {
        readonly players: ReadonlyArray<string>;
        readonly suspects: ReadonlyArray<string>;
        readonly weapons: ReadonlyArray<string>;
        readonly rooms: ReadonlyArray<string>;
    };
    readonly hands: PersistedGameV3["hands"];
    readonly handSizes: PersistedGameV3["handSizes"];
    readonly suggestions: PersistedGameV3["suggestions"];
}

type PersistedGame = PersistedGameV4;

export interface GameSession {
    setup: GameSetup;
    hands: ReadonlyArray<{ player: Player; cards: ReadonlyArray<Card> }>;
    handSizes: ReadonlyArray<{ player: Player; size: number }>;
    suggestions: ReadonlyArray<Suggestion>;
}

export const encodeSession = (session: GameSession): PersistedGame => ({
    version: 4,
    setup: {
        players: session.setup.players.map(p => String(p)),
        categories: session.setup.categories.map(c => ({
            id: String(c.id),
            name: c.name,
            cards: c.cards.map(card => ({
                id: String(card.id),
                name: card.name,
            })),
        })),
    },
    hands: session.hands.map(h => ({
        player: String(h.player),
        cards: h.cards.map(c => String(c)),
    })),
    handSizes: session.handSizes.map(h => ({
        player: String(h.player),
        size: h.size,
    })),
    suggestions: session.suggestions.map(s => ({
        id: String(s.id),
        suggester: String(s.suggester),
        cards: suggestionCards(s).map(c => String(c)),
        nonRefuters: suggestionNonRefuters(s).map(p => String(p)),
        refuter: s.refuter === undefined ? null : String(s.refuter),
        seenCard: s.seenCard === undefined ? null : String(s.seenCard),
    })),
});

const migrateV1ToV2 = (v1: PersistedGameV1): PersistedGameV2 => ({
    version: 2,
    setup: {
        players: v1.setup.players,
        categories: [
            { name: "Suspects", cards: v1.setup.suspects },
            { name: "Weapons",  cards: v1.setup.weapons  },
            { name: "Rooms",    cards: v1.setup.rooms    },
        ],
    },
    hands: v1.hands,
    handSizes: v1.handSizes,
    suggestions: v1.suggestions,
});

/**
 * Migrate a v2 payload to v3 by treating each display-name string as
 * its own id. This is the simplest valid migration: references that
 * used to point at "Miss Scarlet" the name still resolve to "Miss
 * Scarlet" the id. Users only notice the difference when they rename
 * a card; at that point the id stays "Miss Scarlet" (now opaque) and
 * the display name switches.
 */
const migrateV2ToV3 = (v2: PersistedGameV2): PersistedGameV3 => ({
    version: 3,
    setup: {
        players: v2.setup.players,
        categories: v2.setup.categories.map(c => ({
            id: c.name,
            name: c.name,
            cards: c.cards.map(card => ({ id: card, name: card })),
        })),
    },
    hands: v2.hands,
    handSizes: v2.handSizes,
    suggestions: v2.suggestions,
});

/**
 * Convert a Schema-validated v4 payload into the domain GameSession.
 * Branded types already flow through the schema, so this is pure
 * construction — no Player(...) / Card(...) wrapping needed.
 *
 * Shared by the v4 branch (direct decode) and the v3 branch (decode
 * via v3 -> v4 transform); both hand this helper the same shape.
 */
const buildSessionFromV4 = (v4: PersistedSessionV4): GameSession => ({
    setup: GameSetup({
        players: v4.setup.players,
        categories: v4.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v4.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v4.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v4.suggestions.map(s => Suggestion({
        id: s.id === undefined || s.id === SuggestionId("")
            ? newSuggestionId()
            : s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter === null ? undefined : s.refuter,
        seenCard: s.seenCard === null ? undefined : s.seenCard,
    })),
});

export const decodeSession = (data: unknown): GameSession | undefined => {
    if (!data || typeof data !== "object") return undefined;
    const obj = data as { version?: number };

    if (obj.version === 4) {
        const decoded = decodeV4Unknown(data);
        if (Result.isFailure(decoded)) return undefined;
        return buildSessionFromV4(decoded.success);
    }

    if (obj.version === 3) {
        // v3 blobs flow through the Schema.transform v3 -> v4 — same
        // shape on disk, different version byte. Any validation failure
        // collapses to undefined so callers fall back to a fresh session.
        const decoded = decodeV3Unknown(data);
        if (Result.isFailure(decoded)) return undefined;
        return buildSessionFromV4(decoded.success);
    }

    let v3: PersistedGameV3;
    if (obj.version === 1) {
        const v1 = data as Partial<PersistedGameV1>;
        if (!v1.setup || !v1.hands || !v1.handSizes || !v1.suggestions) {
            return undefined;
        }
        const s = v1.setup;
        if (!s.players || !s.suspects || !s.weapons || !s.rooms) {
            return undefined;
        }
        v3 = migrateV2ToV3(migrateV1ToV2(v1 as PersistedGameV1));
    } else if (obj.version === 2) {
        const candidate = data as Partial<PersistedGameV2>;
        if (
            !candidate.setup ||
            !candidate.suggestions ||
            !candidate.hands ||
            !candidate.handSizes
        ) {
            return undefined;
        }
        if (!candidate.setup.players || !candidate.setup.categories) {
            return undefined;
        }
        v3 = migrateV2ToV3(candidate as PersistedGameV2);
    } else {
        return undefined;
    }

    const setup: GameSetup = GameSetup({
        players: v3.setup.players.map(Player),
        categories: v3.setup.categories.map(c => Category({
            id: CardCategory(c.id),
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: Card(card.id),
                name: card.name,
            })),
        })),
    });

    const suggestions = v3.suggestions.map(s => Suggestion({
        // Pre-migration suggestions from v1/v2 (before ids existed) may
        // be missing an id; synthesize a fresh one so downstream refs
        // (provenance, footnotes) stay consistent.
        id: s.id === undefined || s.id === ""
            ? newSuggestionId()
            : SuggestionId(s.id),
        suggester: Player(s.suggester),
        cards: s.cards.map(Card),
        nonRefuters: s.nonRefuters.map(Player),
        refuter: s.refuter === null ? undefined : Player(s.refuter),
        seenCard: s.seenCard === null ? undefined : Card(s.seenCard),
    }));

    return {
        setup,
        hands: v3.hands.map(h => ({
            player: Player(h.player),
            cards: h.cards.map(Card),
        })),
        handSizes: v3.handSizes.map(h => ({
            player: Player(h.player),
            size: h.size,
        })),
        suggestions,
    };
};

// Keep the older keys readable too, so the one-time migration picks
// up existing sessions. New writes go to v4.
const STORAGE_KEY_V4 = "effect-clue.session.v4";
const STORAGE_KEY_V3 = "effect-clue.session.v3";
const STORAGE_KEY_V2 = "effect-clue.session.v2";
const STORAGE_KEY_V1 = "effect-clue.session.v1";

export const saveToLocalStorage = (session: GameSession): void => {
    try {
        const encoded = encodeSession(session);
        window.localStorage.setItem(STORAGE_KEY_V4, JSON.stringify(encoded));
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

export const loadFromLocalStorage = (): GameSession | undefined => {
    try {
        const rawV4 = window.localStorage.getItem(STORAGE_KEY_V4);
        if (rawV4) return decodeSession(JSON.parse(rawV4));
        const rawV3 = window.localStorage.getItem(STORAGE_KEY_V3);
        if (rawV3) return decodeSession(JSON.parse(rawV3));
        const rawV2 = window.localStorage.getItem(STORAGE_KEY_V2);
        if (rawV2) return decodeSession(JSON.parse(rawV2));
        const rawV1 = window.localStorage.getItem(STORAGE_KEY_V1);
        if (rawV1) return decodeSession(JSON.parse(rawV1));
        return undefined;
    } catch {
        return undefined;
    }
};

// Compact URL-safe base64 encoding for shareable links. Clue card names
// are ASCII so plain btoa is safe; if we ever need to support unicode
// player names we'll need a TextEncoder-based path.
export const encodeSessionToUrl = (session: GameSession): string => {
    const json = JSON.stringify(encodeSession(session));
    const b64 = window.btoa(json);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const decodeSessionFromUrl = (encoded: string): GameSession | undefined => {
    try {
        const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        const json = window.atob(padded);
        return decodeSession(JSON.parse(json));
    } catch {
        return undefined;
    }
};
