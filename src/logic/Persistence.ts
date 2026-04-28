import { Result } from "effect";
import {
    Accusation,
    AccusationId,
    accusationCards,
    newAccusationId,
} from "./Accusation";
import { Card, Player } from "./GameObjects";
import { CardEntry, Category, GameSetup } from "./GameSetup";
import {
    decodeV6Unknown,
    type PersistedSessionV6,
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
interface PersistedGameV6 {
    readonly version: 6;
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
        readonly loggedAt: number;
    }>;
    readonly accusations: ReadonlyArray<{
        readonly id?: string | undefined;
        readonly accuser: string;
        readonly cards: ReadonlyArray<string>;
        readonly loggedAt: number;
    }>;
}

type PersistedGame = PersistedGameV6;

export interface GameSession {
    setup: GameSetup;
    hands: ReadonlyArray<{ player: Player; cards: ReadonlyArray<Card> }>;
    handSizes: ReadonlyArray<{ player: Player; size: number }>;
    suggestions: ReadonlyArray<Suggestion>;
    accusations: ReadonlyArray<Accusation>;
}

export const encodeSession = (session: GameSession): PersistedGame => ({
    version: 6,
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
        loggedAt: s.loggedAt,
    })),
    accusations: session.accusations.map(a => ({
        id: String(a.id),
        accuser: String(a.accuser),
        cards: accusationCards(a).map(c => String(c)),
        loggedAt: a.loggedAt,
    })),
});

/**
 * Convert a Schema-validated v6 payload into the domain GameSession.
 * Branded types already flow through the schema, so this is pure
 * construction — no Player(...) / Card(...) wrapping needed.
 */
const buildSessionFromV6 = (v6: PersistedSessionV6): GameSession => ({
    setup: GameSetup({
        players: v6.setup.players,
        categories: v6.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v6.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v6.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v6.suggestions.map(s => Suggestion({
        id: s.id === undefined || s.id === SuggestionId("")
            ? newSuggestionId()
            : s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter === null ? undefined : s.refuter,
        seenCard: s.seenCard === null ? undefined : s.seenCard,
        loggedAt: s.loggedAt,
    })),
    accusations: v6.accusations.map(a => Accusation({
        id: a.id === undefined || a.id === AccusationId("")
            ? newAccusationId()
            : a.id,
        accuser: a.accuser,
        cards: a.cards,
        loggedAt: a.loggedAt,
    })),
});

export const decodeSession = (data: unknown): GameSession | undefined => {
    const decoded = decodeV6Unknown(data);
    if (Result.isFailure(decoded)) return undefined;
    return buildSessionFromV6(decoded.success);
};

const STORAGE_KEY = "effect-clue.session.v6";

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
