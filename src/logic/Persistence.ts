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
    CellHypothesis,
    ownerFromPersisted,
} from "./Hypothesis";
import {
    decodePersistedSessionUnknown,
    type PersistedSession,
    type PersistedSessionV6,
    type PersistedSessionV7,
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
interface PersistedGameV7 {
    readonly version: 7;
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
    readonly hypotheses: ReadonlyArray<{
        readonly owner:
            | { readonly _tag: "Player"; readonly player: string }
            | { readonly _tag: "CaseFile" };
        readonly card: string;
        readonly value: "Y" | "N";
    }>;
}

type PersistedGame = PersistedGameV7;

export interface GameSession {
    setup: GameSetup;
    hands: ReadonlyArray<{ player: Player; cards: ReadonlyArray<Card> }>;
    handSizes: ReadonlyArray<{ player: Player; size: number }>;
    suggestions: ReadonlyArray<Suggestion>;
    accusations: ReadonlyArray<Accusation>;
    hypotheses?: ReadonlyArray<CellHypothesis>;
}

export const encodeSession = (session: GameSession): PersistedGame => ({
    version: 7,
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
    hypotheses: (session.hypotheses ?? []).map(h => ({
        owner:
            h.owner._tag === "Player"
                ? {
                      _tag: "Player",
                      player: String(h.owner.player),
                  }
                : { _tag: "CaseFile" },
        card: String(h.card),
        value: h.value,
    })),
});

/**
 * Convert a Schema-validated v6 payload into the domain GameSession.
 * Branded types already flow through the schema, so this is pure
 * construction — no Player(...) / Card(...) wrapping needed.
 */
const buildSessionBase = (
    v6: PersistedSessionV6 | PersistedSessionV7,
): GameSession => ({
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
    hypotheses: [],
});

const buildHypothesesFromV7 = (
    v7: PersistedSessionV7,
): ReadonlyArray<CellHypothesis> =>
    v7.hypotheses.map(h => CellHypothesis({
        owner: ownerFromPersisted(h.owner),
        card: h.card,
        value: h.value,
    }));

const buildSessionFromPersisted = (session: PersistedSession): GameSession => {
    const base = buildSessionBase(session);
    return session.version === 7
        ? { ...base, hypotheses: buildHypothesesFromV7(session) }
        : base;
};

export const decodeSession = (data: unknown): GameSession | undefined => {
    const decoded = decodePersistedSessionUnknown(data);
    if (Result.isFailure(decoded)) return undefined;
    return buildSessionFromPersisted(decoded.success);
};

const STORAGE_KEY = "effect-clue.session.v7";
const LEGACY_STORAGE_KEY_V6 = "effect-clue.session.v6";

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
        const raw =
            window.localStorage.getItem(STORAGE_KEY) ??
            window.localStorage.getItem(LEGACY_STORAGE_KEY_V6);
        if (!raw) return undefined;
        return decodeSession(JSON.parse(raw));
    } catch {
        return undefined;
    }
};

// The base64 `?state=...` URL share path that previously lived here was
// dropped during the M3 SSR + RQ refactor — its replacement is the
// server-stored `/share/[id]` route, which lands in M9 with a richer
// sender-controlled snapshot UI. Old base64 share links no longer
// hydrate the app on landing; the per-user direction was that nobody
// is using them, so no back-compat layer was added.
