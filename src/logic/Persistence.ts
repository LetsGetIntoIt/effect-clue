import { Card, Player } from "./GameObjects";
import { GameSetup } from "./GameSetup";
import { Suggestion, suggestionCards, suggestionNonRefuters } from "./Suggestion";

/**
 * JSON representation of the mutable parts of a game session. We
 * serialize just enough to reconstruct the inputs — the derived
 * knowledge is cheap to recompute so there's no need to persist it.
 *
 * We roll simple manual encoders rather than pulling in @effect/schema
 * because (a) the on-disk shape is tiny, (b) we want stable keys we
 * control for future migrations, and (c) the main codebase's `effect`
 * version doesn't include Schema.
 */
export interface PersistedGame {
    readonly version: 1;
    readonly setup: {
        readonly players: ReadonlyArray<string>;
        readonly suspects: ReadonlyArray<string>;
        readonly weapons: ReadonlyArray<string>;
        readonly rooms: ReadonlyArray<string>;
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
        readonly suggester: string;
        readonly cards: ReadonlyArray<string>;
        readonly nonRefuters: ReadonlyArray<string>;
        readonly refuter: string | null;
        readonly seenCard: string | null;
    }>;
}

export interface GameSession {
    setup: GameSetup;
    hands: ReadonlyArray<{ player: Player; cards: ReadonlyArray<Card> }>;
    handSizes: ReadonlyArray<{ player: Player; size: number }>;
    suggestions: ReadonlyArray<Suggestion>;
}

export const encodeSession = (session: GameSession): PersistedGame => ({
    version: 1,
    setup: {
        players: session.setup.players.map(p => String(p)),
        suspects: session.setup.suspects.map(c => String(c)),
        weapons: session.setup.weapons.map(c => String(c)),
        rooms: session.setup.rooms.map(c => String(c)),
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
        suggester: String(s.suggester),
        cards: suggestionCards(s).map(c => String(c)),
        nonRefuters: suggestionNonRefuters(s).map(p => String(p)),
        refuter: s.refuter === undefined ? null : String(s.refuter),
        seenCard: s.seenCard === undefined ? null : String(s.seenCard),
    })),
});

export const decodeSession = (data: unknown): GameSession | undefined => {
    if (!data || typeof data !== "object") return undefined;
    const obj = data as Partial<PersistedGame>;
    if (obj.version !== 1) return undefined;
    if (!obj.setup || !obj.suggestions || !obj.hands || !obj.handSizes) {
        return undefined;
    }

    const setup: GameSetup = GameSetup({
        players: obj.setup.players.map(Player),
        suspects: obj.setup.suspects.map(Card),
        weapons: obj.setup.weapons.map(Card),
        rooms: obj.setup.rooms.map(Card),
    });

    const suggestions = obj.suggestions.map(s => Suggestion({
        suggester: Player(s.suggester),
        cards: s.cards.map(Card),
        nonRefuters: s.nonRefuters.map(Player),
        refuter: s.refuter === null ? undefined : Player(s.refuter),
        seenCard: s.seenCard === null ? undefined : Card(s.seenCard),
    }));

    return {
        setup,
        hands: obj.hands.map(h => ({
            player: Player(h.player),
            cards: h.cards.map(Card),
        })),
        handSizes: obj.handSizes.map(h => ({
            player: Player(h.player),
            size: h.size,
        })),
        suggestions,
    };
};

const STORAGE_KEY = "effect-clue.session.v1";

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

export const clearLocalStorage = (): void => {
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore.
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

