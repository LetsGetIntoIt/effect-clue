import { Result } from "effect";
import { Card, Player } from "./GameObjects";
import { CardEntry, Category, GameSetup } from "./GameSetup";
import {
    decodeV1Unknown,
    decodeV2Unknown,
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
 *        (`PersistenceSchema.ts`). Malformed payloads produce a
 *        structured `SchemaError` instead of silent `undefined`.
 *
 * Writes always go to v4. Legacy payloads (v1/v2/v3) flow through
 * the v1 -> v2 -> v3 -> v4 Schema chain in PersistenceSchema.ts and
 * are re-stamped as v4 the next time they're persisted.
 */
interface PersistedGameV4 {
    readonly version: 4;
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
        readonly cards: ReadonlyArray<string>;
    }>;
    readonly handSizes: ReadonlyArray<{
        readonly player: string;
        readonly size: number;
    }>;
    readonly suggestions: ReadonlyArray<{
        readonly id?: string | undefined;
        readonly suggester: string;
        readonly cards: ReadonlyArray<string>;
        readonly nonRefuters: ReadonlyArray<string>;
        readonly refuter: string | null;
        readonly seenCard: string | null;
    }>;
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

/**
 * Convert a Schema-validated v4 payload into the domain GameSession.
 * Branded types already flow through the schema, so this is pure
 * construction — no Player(...) / Card(...) wrapping needed.
 *
 * Shared by every version branch: v4 direct, v3/v2/v1 via Schema
 * chain -> v4.
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

    if (obj.version === 2) {
        // v2 flows through Schema too: the v2 -> v3 transform synthesises
        // ids from display names (same behaviour as the old hand-rolled
        // migrateV2ToV3). Result is v3-shaped; bump to v4 and build.
        const decoded = decodeV2Unknown(data);
        if (Result.isFailure(decoded)) return undefined;
        return buildSessionFromV4({ ...decoded.success, version: 4 as const });
    }

    if (obj.version === 1) {
        // v1 chains through v1 -> v2 -> v3 -> v4 via Schema: the v1
        // decoder bumps to v2 shape, then we feed that to the v2
        // decoder to reach v3, then stamp v4 for buildSessionFromV4.
        const decodedV1 = decodeV1Unknown(data);
        if (Result.isFailure(decodedV1)) return undefined;
        const decodedV2 = decodeV2Unknown(decodedV1.success);
        if (Result.isFailure(decodedV2)) return undefined;
        return buildSessionFromV4({
            ...decodedV2.success,
            version: 4 as const,
        });
    }

    return undefined;
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
