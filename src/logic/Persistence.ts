import { Card, CardCategory, Player } from "./GameObjects";
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
 *
 * v1 hardcoded suspects/weapons/rooms; v2 generalized to a `categories`
 * array so decks can have any number of categories with any names.
 */
export interface PersistedGameV2 {
    readonly version: 2;
    readonly setup: {
        readonly players: ReadonlyArray<string>;
        readonly categories: ReadonlyArray<{
            readonly name: string;
            readonly cards: ReadonlyArray<string>;
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
        readonly suggester: string;
        readonly cards: ReadonlyArray<string>;
        readonly nonRefuters: ReadonlyArray<string>;
        readonly refuter: string | null;
        readonly seenCard: string | null;
    }>;
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
    readonly hands: PersistedGameV2["hands"];
    readonly handSizes: PersistedGameV2["handSizes"];
    readonly suggestions: PersistedGameV2["suggestions"];
}

export type PersistedGame = PersistedGameV2;

export interface GameSession {
    setup: GameSetup;
    hands: ReadonlyArray<{ player: Player; cards: ReadonlyArray<Card> }>;
    handSizes: ReadonlyArray<{ player: Player; size: number }>;
    suggestions: ReadonlyArray<Suggestion>;
}

export const encodeSession = (session: GameSession): PersistedGame => ({
    version: 2,
    setup: {
        players: session.setup.players.map(p => String(p)),
        categories: session.setup.categories.map(c => ({
            name: String(c.name),
            cards: c.cards.map(card => String(card)),
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

export const decodeSession = (data: unknown): GameSession | undefined => {
    if (!data || typeof data !== "object") return undefined;
    const obj = data as { version?: number };

    let v2: PersistedGameV2;
    if (obj.version === 1) {
        const v1 = data as Partial<PersistedGameV1>;
        if (!v1.setup || !v1.hands || !v1.handSizes || !v1.suggestions) {
            return undefined;
        }
        const s = v1.setup;
        if (!s.players || !s.suspects || !s.weapons || !s.rooms) {
            return undefined;
        }
        v2 = migrateV1ToV2(v1 as PersistedGameV1);
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
        v2 = candidate as PersistedGameV2;
    } else {
        return undefined;
    }

    const setup: GameSetup = GameSetup({
        players: v2.setup.players.map(Player),
        categories: v2.setup.categories.map(c => ({
            name: CardCategory(c.name),
            cards: c.cards.map(Card),
        })),
    });

    const suggestions = v2.suggestions.map(s => Suggestion({
        suggester: Player(s.suggester),
        cards: s.cards.map(Card),
        nonRefuters: s.nonRefuters.map(Player),
        refuter: s.refuter === null ? undefined : Player(s.refuter),
        seenCard: s.seenCard === null ? undefined : Card(s.seenCard),
    }));

    return {
        setup,
        hands: v2.hands.map(h => ({
            player: Player(h.player),
            cards: h.cards.map(Card),
        })),
        handSizes: v2.handSizes.map(h => ({
            player: Player(h.player),
            size: h.size,
        })),
        suggestions,
    };
};

// Keep the legacy v1 key so existing users pick their session up once on
// upgrade; new writes go to v2. A future migration can delete v1 after
// we're confident everyone has rolled forward.
const STORAGE_KEY_V2 = "effect-clue.session.v2";
const STORAGE_KEY_V1 = "effect-clue.session.v1";

export const saveToLocalStorage = (session: GameSession): void => {
    try {
        const encoded = encodeSession(session);
        window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(encoded));
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

export const loadFromLocalStorage = (): GameSession | undefined => {
    try {
        const rawV2 = window.localStorage.getItem(STORAGE_KEY_V2);
        if (rawV2) return decodeSession(JSON.parse(rawV2));
        const rawV1 = window.localStorage.getItem(STORAGE_KEY_V1);
        if (rawV1) return decodeSession(JSON.parse(rawV1));
        return undefined;
    } catch {
        return undefined;
    }
};

export const clearLocalStorage = (): void => {
    try {
        window.localStorage.removeItem(STORAGE_KEY_V2);
        window.localStorage.removeItem(STORAGE_KEY_V1);
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
