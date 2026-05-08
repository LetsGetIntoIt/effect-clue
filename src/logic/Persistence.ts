import { HashMap, Result } from "effect";
import {
    Accusation,
    AccusationId,
    accusationCards,
    newAccusationId,
} from "./Accusation";
import {
    CaseFileOwner,
    Card,
    Player,
    PlayerOwner,
} from "./GameObjects";
import { CardEntry, Category, GameSetup } from "./GameSetup";
import {
    emptyHypotheses,
    type HypothesisMap,
    type HypothesisValue,
} from "./Hypothesis";
import { Cell } from "./Knowledge";
import {
    decodeV6Unknown,
    decodeV7Unknown,
    decodeV8Unknown,
    type PersistedHypothesis,
    type PersistedPendingSuggestion,
    type PersistedSessionV6,
    type PersistedSessionV7,
    type PersistedSessionV8,
} from "./PersistenceSchema";
import type { PendingSuggestionDraft } from "./ClueState";
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
 * v8 (current) adds `pendingSuggestion` — the in-flight new-suggestion
 * draft, persisted so it survives mobile tab swaps and reloads.
 * v7 / v6 reads still work via {@link decodeV7Unknown} / {@link
 * decodeV6Unknown}; they're auto-lifted with `pendingSuggestion: null`
 * (and `hypotheses: []` for v6). Writes always produce v8.
 */
interface PersistedGameV8 {
    readonly version: 8;
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
        readonly player: string | null;
        readonly card: string;
        readonly value: "Y" | "N";
    }>;
    readonly pendingSuggestion: PersistedPendingSuggestion | null;
}

type PersistedGame = PersistedGameV8;

export interface GameSession {
    setup: GameSetup;
    hands: ReadonlyArray<{ player: Player; cards: ReadonlyArray<Card> }>;
    handSizes: ReadonlyArray<{ player: Player; size: number }>;
    suggestions: ReadonlyArray<Suggestion>;
    accusations: ReadonlyArray<Accusation>;
    hypotheses: HypothesisMap;
    pendingSuggestion: PendingSuggestionDraft | null;
}

const encodeHypotheses = (
    hypotheses: HypothesisMap,
): PersistedGameV8["hypotheses"] => {
    const out: Array<PersistedGameV8["hypotheses"][number]> = [];
    for (const [cell, value] of hypotheses) {
        const player =
            cell.owner._tag === "Player"
                ? String(cell.owner.player)
                : null;
        out.push({ player, card: String(cell.card), value });
    }
    return out;
};

// ---- Pending-suggestion encoding -------------------------------------
//
// `PendingSuggestionDraft` slots have three runtime states: `null`
// ("not decided"), Nobody ("explicit no one"), or a typed Player/Card.
// The persisted form uses a pair of flat booleans + the value field
// per slot to round-trip them without `Schema.Union`:
//
//   decided=false                  -> null
//   decided=true, isNobody=true    -> Nobody
//   decided=true, isNobody=false   -> the value (Player / Card / Player[])
//
// Mirrors the flat encoding pattern used by the persisted hypothesis
// schema. See PersistenceSchema.ts for the rationale.

const NOBODY_DRAFT = Object.freeze({
    kind: "nobody" as const,
});

const isPendingNobody = (
    v: unknown,
): v is { readonly kind: "nobody" } =>
    typeof v === "object"
    && v !== null
    && !Array.isArray(v)
    && (v as { kind?: unknown }).kind === "nobody";

const encodePendingSuggestion = (
    pending: PendingSuggestionDraft | null,
): PersistedPendingSuggestion | null => {
    if (pending === null) return null;
    const { nonRefuters, refuter, seenCard } = pending;
    const nonRefutersDecided = nonRefuters !== null;
    const nonRefutersIsNobody = isPendingNobody(nonRefuters);
    const refuterDecided = refuter !== null;
    const refuterIsNobody = isPendingNobody(refuter);
    const seenCardDecided = seenCard !== null;
    const seenCardIsNobody = isPendingNobody(seenCard);
    return {
        id: pending.id,
        suggester: pending.suggester,
        cards: pending.cards,
        nonRefutersDecided,
        nonRefutersIsNobody,
        nonRefuters:
            nonRefuters === null || isPendingNobody(nonRefuters)
                ? []
                : nonRefuters,
        refuterDecided,
        refuterIsNobody,
        refuter:
            refuter === null || isPendingNobody(refuter) ? null : refuter,
        seenCardDecided,
        seenCardIsNobody,
        seenCard:
            seenCard === null || isPendingNobody(seenCard)
                ? null
                : seenCard,
    };
};

const decodePendingSuggestion = (
    persisted: PersistedPendingSuggestion | null,
): PendingSuggestionDraft | null => {
    if (persisted === null) return null;
    const decodeNullable = <T,>(
        decided: boolean,
        isNobody: boolean,
        value: T | null,
    ): T | { readonly kind: "nobody" } | null => {
        if (!decided) return null;
        if (isNobody) return NOBODY_DRAFT;
        return value;
    };
    const decodePassers = (
        decided: boolean,
        isNobody: boolean,
        value: ReadonlyArray<Player>,
    ): ReadonlyArray<Player> | { readonly kind: "nobody" } | null => {
        if (!decided) return null;
        if (isNobody) return NOBODY_DRAFT;
        return value;
    };
    return {
        id: persisted.id,
        suggester: persisted.suggester,
        cards: persisted.cards,
        nonRefuters: decodePassers(
            persisted.nonRefutersDecided,
            persisted.nonRefutersIsNobody,
            persisted.nonRefuters,
        ),
        refuter: decodeNullable(
            persisted.refuterDecided,
            persisted.refuterIsNobody,
            persisted.refuter,
        ),
        seenCard: decodeNullable(
            persisted.seenCardDecided,
            persisted.seenCardIsNobody,
            persisted.seenCard,
        ),
    };
};

const decodeHypotheses = (
    raw: ReadonlyArray<PersistedHypothesis>,
): HypothesisMap => {
    let m: HypothesisMap = emptyHypotheses;
    for (const h of raw) {
        const owner =
            h.player !== null ? PlayerOwner(h.player) : CaseFileOwner();
        m = HashMap.set(m, Cell(owner, h.card), h.value as HypothesisValue);
    }
    return m;
};

export const encodeSession = (session: GameSession): PersistedGame => ({
    version: 8,
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
    hypotheses: encodeHypotheses(session.hypotheses),
    pendingSuggestion: encodePendingSuggestion(session.pendingSuggestion),
});

const buildSessionFromV8 = (v8: PersistedSessionV8): GameSession => ({
    setup: GameSetup({
        players: v8.setup.players,
        categories: v8.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v8.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v8.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v8.suggestions.map(s => Suggestion({
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
    accusations: v8.accusations.map(a => Accusation({
        id: a.id === undefined || a.id === AccusationId("")
            ? newAccusationId()
            : a.id,
        accuser: a.accuser,
        cards: a.cards,
        loggedAt: a.loggedAt,
    })),
    hypotheses: decodeHypotheses(v8.hypotheses),
    pendingSuggestion: decodePendingSuggestion(v8.pendingSuggestion),
});

const buildSessionFromV7 = (v7: PersistedSessionV7): GameSession => ({
    setup: GameSetup({
        players: v7.setup.players,
        categories: v7.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v7.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v7.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v7.suggestions.map(s => Suggestion({
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
    accusations: v7.accusations.map(a => Accusation({
        id: a.id === undefined || a.id === AccusationId("")
            ? newAccusationId()
            : a.id,
        accuser: a.accuser,
        cards: a.cards,
        loggedAt: a.loggedAt,
    })),
    hypotheses: decodeHypotheses(v7.hypotheses),
    pendingSuggestion: null,
});

/**
 * Lift a v6 payload to v8 by attaching an empty hypothesis set and a
 * null pending-suggestion draft. Forward-only and lossless.
 */
const liftV6ToV7 = (v6: PersistedSessionV6): GameSession => ({
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
    hypotheses: emptyHypotheses,
    pendingSuggestion: null,
});

export const decodeSession = (data: unknown): GameSession | undefined => {
    const v8 = decodeV8Unknown(data);
    if (Result.isSuccess(v8)) return buildSessionFromV8(v8.success);
    const v7 = decodeV7Unknown(data);
    if (Result.isSuccess(v7)) return buildSessionFromV7(v7.success);
    const v6 = decodeV6Unknown(data);
    if (Result.isSuccess(v6)) return liftV6ToV7(v6.success);
    return undefined;
};

const STORAGE_KEY = "effect-clue.session.v8";
const LEGACY_STORAGE_KEY_V7 = "effect-clue.session.v7";
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
        const rawV8 = window.localStorage.getItem(STORAGE_KEY);
        if (rawV8) return decodeSession(JSON.parse(rawV8));
        const rawV7 = window.localStorage.getItem(LEGACY_STORAGE_KEY_V7);
        if (rawV7) return decodeSession(JSON.parse(rawV7));
        const rawV6 = window.localStorage.getItem(LEGACY_STORAGE_KEY_V6);
        if (rawV6) return decodeSession(JSON.parse(rawV6));
        return undefined;
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
