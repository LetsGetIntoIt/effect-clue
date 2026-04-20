import { Result } from "effect";
import { Card, Player } from "./GameObjects";
import { CardEntry, Category, GameSetup } from "./GameSetup";
import {
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
 * JSON representation of the mutable parts of a game session. Only
 * the mutable inputs are serialized; derived knowledge is cheap to
 * recompute, so there's no need to persist it.
 *
 * The app is pre-production, so there's one on-disk format. If an
 * older / malformed blob ever shows up, decode returns undefined
 * and the caller falls back to a fresh session.
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
    const decoded = decodeV4Unknown(data);
    if (Result.isFailure(decoded)) return undefined;
    return buildSessionFromV4(decoded.success);
};

const STORAGE_KEY = "effect-clue.session.v4";

export const saveToLocalStorage = (session: GameSession): void => {
    try {
        const encoded = encodeSession(session);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encoded));
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

export const loadFromLocalStorage = (): GameSession | undefined => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return undefined;
        return decodeSession(JSON.parse(raw));
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
